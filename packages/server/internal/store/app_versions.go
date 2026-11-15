package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// CreateVersion 以草稿状态插入版本（灰度 0、未强更），返回完整记录。
// 版本号唯一性由数据库约束保证。
func (s *Store) CreateVersion(ctx context.Context, record VersionRecord) (VersionRecord, error) {
	schedule, err := json.Marshal(record.GrayIncrementSchedule)
	if err != nil {
		return VersionRecord{}, err
	}
	if record.GrayIncrementSchedule == nil {
		schedule = []byte("[]")
	}
	now := NowMS()
	result, err := s.Writer.ExecContext(ctx,
		`INSERT INTO app_versions
		   (app_id, version_name, version_code, file_size, checksum, storage_root_id, category, rel_path,
		    update_log, force_update, min_version_code, gray_percent, gray_auto_increment,
		    gray_increment_schedule, status, remark, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'draft', ?, ?, ?)`,
		record.AppID, record.VersionName, record.VersionCode, record.FileSize, record.Checksum,
		record.StorageRootID, record.Category, record.RelPath, record.UpdateLog,
		boolInt(record.ForceUpdate), record.MinVersionCode, string(schedule), record.Remark, now, now)
	if err != nil {
		return VersionRecord{}, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return VersionRecord{}, err
	}
	return s.VersionByID(ctx, id)
}

// VersionByID 按主键读取版本（含所属应用的 key 与平台）；
// 不存在返回 ErrNotFound。
func (s *Store) VersionByID(ctx context.Context, id int64) (VersionRecord, error) {
	row := s.Reader.QueryRowContext(ctx, versionSelect+` WHERE v.id = ?`, id)
	record, err := scanVersion(row)
	if errors.Is(err, sql.ErrNoRows) {
		return VersionRecord{}, ErrNotFound
	}
	return record, err
}

const versionSelect = `SELECT v.id, v.app_id, a.app_key, a.platform, v.version_name, v.version_code,
	v.file_size, v.checksum, v.storage_root_id, v.category, v.rel_path, v.update_log,
	v.force_update, v.min_version_code, v.gray_percent, v.gray_auto_increment,
	v.gray_increment_schedule, v.scheduled_publish_at, v.scheduled_publish_mode,
	v.scheduled_gray_percent, v.status, v.offline_reason, v.publish_time, v.remark,
	v.created_at, v.updated_at
	FROM app_versions v JOIN apps a ON a.id = v.app_id`

func scanVersion(row rowScanner) (VersionRecord, error) {
	var (
		record            VersionRecord
		forceUpdate       int
		grayAutoIncrement int
		schedule          string
		scheduledAt       sql.NullInt64
		publishTime       sql.NullInt64
		createdAt         int64
		updatedAt         int64
	)
	if err := row.Scan(&record.ID, &record.AppID, &record.AppKey, &record.Platform, &record.VersionName,
		&record.VersionCode, &record.FileSize, &record.Checksum, &record.StorageRootID,
		&record.Category, &record.RelPath, &record.UpdateLog, &forceUpdate, &record.MinVersionCode,
		&record.GrayPercent, &grayAutoIncrement, &schedule, &scheduledAt, &record.ScheduledPublishMode,
		&record.ScheduledGrayPercent, &record.Status, &record.OfflineReason, &publishTime,
		&record.Remark, &createdAt, &updatedAt); err != nil {
		return VersionRecord{}, err
	}
	record.ForceUpdate = forceUpdate == 1
	record.GrayAutoIncrement = grayAutoIncrement == 1
	if err := json.Unmarshal([]byte(schedule), &record.GrayIncrementSchedule); err != nil {
		record.GrayIncrementSchedule = nil
	}
	if scheduledAt.Valid && scheduledAt.Int64 > 0 {
		record.ScheduledPublishAt = NullTime(&scheduledAt.Int64)
	}
	if publishTime.Valid && publishTime.Int64 > 0 {
		record.PublishTime = NullTime(&publishTime.Int64)
	}
	record.CreatedAt = Time(createdAt)
	record.UpdatedAt = Time(updatedAt)
	return record, nil
}

// ListVersions 返回某应用的一页版本，按版本号倒序。
func (s *Store) ListVersions(ctx context.Context, filter VersionFilter) ([]VersionRecord, int, error) {
	where := []string{"a.app_key = ?"}
	args := []any{filter.AppKey}
	if filter.Platform != "" {
		where = append(where, "a.platform = ?")
		args = append(args, filter.Platform)
	}
	switch filter.Status {
	case "":
	case "gray":
		where = append(where, "v.status = 'published' AND v.gray_percent < 100")
	case "full":
		where = append(where, "v.status = 'published' AND v.gray_percent >= 100")
	default:
		where = append(where, "v.status = ?")
		args = append(args, filter.Status)
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.Reader.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM app_versions v JOIN apps a ON a.id = v.app_id`+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	page, pageSize := filter.Page, filter.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.Reader.QueryContext(ctx,
		versionSelect+clause+` ORDER BY v.version_code DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]VersionRecord, 0, pageSize)
	for rows.Next() {
		record, err := scanVersion(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, record)
	}
	return items, total, rows.Err()
}

// UpdateVersion 应用部分更新；灰度比例会被夹紧到 0-100。
// 版本不存在返回 ErrNotFound。
func (s *Store) UpdateVersion(ctx context.Context, id int64, update VersionUpdate) error {
	sets := []string{"updated_at = ?"}
	args := []any{NowMS()}
	if update.VersionName != nil {
		sets = append(sets, "version_name = ?")
		args = append(args, *update.VersionName)
	}
	if update.UpdateLog != nil {
		sets = append(sets, "update_log = ?")
		args = append(args, *update.UpdateLog)
	}
	if update.Remark != nil {
		sets = append(sets, "remark = ?")
		args = append(args, *update.Remark)
	}
	if update.ForceUpdate != nil {
		sets = append(sets, "force_update = ?")
		args = append(args, boolInt(*update.ForceUpdate))
	}
	if update.MinVersionCode != nil {
		sets = append(sets, "min_version_code = ?")
		args = append(args, *update.MinVersionCode)
	}
	if update.GrayPercent != nil {
		sets = append(sets, "gray_percent = ?")
		args = append(args, clampPercent(*update.GrayPercent))
	}
	if update.GrayAutoIncrement != nil {
		sets = append(sets, "gray_auto_increment = ?")
		args = append(args, boolInt(*update.GrayAutoIncrement))
	}
	if update.Schedule != nil {
		body, err := json.Marshal(*update.Schedule)
		if err != nil {
			return err
		}
		sets = append(sets, "gray_increment_schedule = ?")
		args = append(args, string(body))
	}
	if update.ScheduledAt != nil {
		if *update.ScheduledAt <= 0 {
			sets = append(sets, "scheduled_publish_at = NULL")
		} else {
			sets = append(sets, "scheduled_publish_at = ?")
			args = append(args, *update.ScheduledAt)
		}
	}
	if update.ScheduledMode != nil {
		sets = append(sets, "scheduled_publish_mode = ?")
		args = append(args, *update.ScheduledMode)
	}
	if update.ScheduledGrayPercent != nil {
		sets = append(sets, "scheduled_gray_percent = ?")
		args = append(args, clampPercent(*update.ScheduledGrayPercent))
	}
	args = append(args, id)
	result, err := s.Writer.ExecContext(ctx,
		"UPDATE app_versions SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteVersion 删除版本记录，不删除磁盘安装包；
// 不存在返回 ErrNotFound。
func (s *Store) DeleteVersion(ctx context.Context, id int64) error {
	result, err := s.Writer.ExecContext(ctx, "DELETE FROM app_versions WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func clampPercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
