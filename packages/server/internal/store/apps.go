package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"vakao-static-hub/server/internal/model"
)

// AppRecord 携带作为版本外键使用的内部 id。
type AppRecord struct {
	ID int64
	model.App
}

// VersionRecord 是一个应用版本及其所属应用的 id。
type VersionRecord struct {
	AppID int64
	model.AppVersion
}

type VersionFilter struct {
	AppKey   string
	Platform string
	Status   string
	Page     int
	PageSize int
}

type VersionUpdate struct {
	VersionName          *string
	UpdateLog            *string
	Remark               *string
	ForceUpdate          *bool
	MinVersionCode       *int64
	GrayPercent          *int
	GrayAutoIncrement    *bool
	Schedule             *[]model.GrayStep
	ScheduledAt          *int64 // 0 表示清除定时
	ScheduledMode        *string
	ScheduledGrayPercent *int
}

func (s *Store) ListApps(ctx context.Context) ([]model.App, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT app_key, platform, name, created_at, updated_at FROM apps ORDER BY app_key, platform`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	apps := make([]model.App, 0, 8)
	for rows.Next() {
		var (
			app       model.App
			createdAt int64
			updatedAt int64
		)
		if err := rows.Scan(&app.AppKey, &app.Platform, &app.Name, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		app.CreatedAt = Time(createdAt)
		app.UpdatedAt = Time(updatedAt)
		apps = append(apps, app)
	}
	return apps, rows.Err()
}

func (s *Store) AppByKey(ctx context.Context, appKey, platform string) (AppRecord, error) {
	row := s.Reader.QueryRowContext(ctx,
		`SELECT id, app_key, platform, name, created_at, updated_at FROM apps WHERE app_key = ? AND platform = ?`,
		appKey, platform)
	var (
		record    AppRecord
		createdAt int64
		updatedAt int64
	)
	if err := row.Scan(&record.ID, &record.AppKey, &record.Platform, &record.Name, &createdAt, &updatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AppRecord{}, ErrNotFound
		}
		return AppRecord{}, err
	}
	record.CreatedAt = Time(createdAt)
	record.UpdatedAt = Time(updatedAt)
	return record, nil
}

func (s *Store) CreateApp(ctx context.Context, app model.App) (model.App, error) {
	now := NowMS()
	if app.Platform == "" {
		app.Platform = "android"
	}
	if _, err := s.Writer.ExecContext(ctx,
		`INSERT INTO apps (app_key, platform, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
		app.AppKey, app.Platform, app.Name, now, now); err != nil {
		return model.App{}, err
	}
	record, err := s.AppByKey(ctx, app.AppKey, app.Platform)
	if err != nil {
		return model.App{}, err
	}
	return record.App, nil
}

func (s *Store) UpdateAppName(ctx context.Context, appKey, platform, name string) error {
	result, err := s.Writer.ExecContext(ctx,
		`UPDATE apps SET name = ?, updated_at = ? WHERE app_key = ? AND platform = ?`,
		name, NowMS(), appKey, platform)
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

// RenameApp 修改对外的应用 key。版本引用的是内部 id，
// 因此只需更新 apps 行与冗余的事件 key。
func (s *Store) RenameApp(ctx context.Context, appKey, platform, newKey string) error {
	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx,
		`UPDATE apps SET app_key = ?, updated_at = ? WHERE app_key = ? AND platform = ?`,
		newKey, NowMS(), appKey, platform)
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
	if _, err := tx.ExecContext(ctx,
		`UPDATE app_upgrade_events SET app_key = ? WHERE app_key = ?`, newKey, appKey); err != nil {
		return err
	}
	return tx.Commit()
}

// CountAppVersions 返回某应用下的版本数量。
func (s *Store) CountAppVersions(ctx context.Context, appKey, platform string) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM app_versions v JOIN apps a ON a.id = v.app_id
		 WHERE a.app_key = ? AND a.platform = ?`, appKey, platform).Scan(&n)
	return n, err
}

func (s *Store) DeleteApp(ctx context.Context, appKey, platform string) error {
	result, err := s.Writer.ExecContext(ctx,
		`DELETE FROM apps WHERE app_key = ? AND platform = ?`, appKey, platform)
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

// PublishVersion 将版本标记为已发布。scheduledAt 为 nil 时
// 版本立即上线。
func (s *Store) PublishVersion(ctx context.Context, id int64, grayPercent int, publishAt int64) error {
	result, err := s.Writer.ExecContext(ctx,
		`UPDATE app_versions SET status = 'published', gray_percent = ?, publish_time = ?,
		   scheduled_publish_at = NULL, offline_reason = '', updated_at = ? WHERE id = ?`,
		clampPercent(grayPercent), publishAt, NowMS(), id)
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

// SchedulePublish 在草稿上记录未来的发布请求。
func (s *Store) SchedulePublish(ctx context.Context, id int64, publishAt int64, mode string, grayPercent int) error {
	_, err := s.Writer.ExecContext(ctx,
		`UPDATE app_versions SET scheduled_publish_at = ?, scheduled_publish_mode = ?,
		   scheduled_gray_percent = ?, updated_at = ? WHERE id = ?`,
		publishAt, mode, clampPercent(grayPercent), NowMS(), id)
	return err
}

func (s *Store) SetVersionStatus(ctx context.Context, id int64, status, reason string) error {
	result, err := s.Writer.ExecContext(ctx,
		`UPDATE app_versions SET status = ?, offline_reason = ?, updated_at = ? WHERE id = ?`,
		status, reason, NowMS(), id)
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

// LatestPublished 返回某应用的所有已发布版本，按版本
// 号倒序排列。灰度分桶由调用方处理。
func (s *Store) LatestPublished(ctx context.Context, appKey, platform string) ([]VersionRecord, error) {
	rows, err := s.Reader.QueryContext(ctx,
		versionSelect+` WHERE a.app_key = ? AND a.platform = ? AND v.status = 'published'
		 ORDER BY v.version_code DESC LIMIT 20`, appKey, platform)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]VersionRecord, 0, 4)
	for rows.Next() {
		record, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, record)
	}
	return items, rows.Err()
}

// RollbackCandidates 列出可恢复的较旧版本。手动
// 下架的构建会被排除；因上一次回滚而下架的构建仍然
// 可选，以便撤销该回滚。
func (s *Store) RollbackCandidates(ctx context.Context, appID, versionCode int64) ([]VersionRecord, error) {
	rows, err := s.Reader.QueryContext(ctx,
		versionSelect+` WHERE v.app_id = ? AND v.version_code < ?
		 AND (v.status IN ('published', 'gray') OR (v.status = 'offline' AND v.offline_reason = 'rolled back'))
		 ORDER BY v.version_code DESC LIMIT 50`, appID, versionCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]VersionRecord, 0, 8)
	for rows.Next() {
		record, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, record)
	}
	return items, rows.Err()
}

// DueScheduledVersions 返回已到发布时间的草稿。
func (s *Store) DueScheduledVersions(ctx context.Context, now int64) ([]VersionRecord, error) {
	rows, err := s.Reader.QueryContext(ctx,
		versionSelect+` WHERE v.status = 'draft' AND v.scheduled_publish_at IS NOT NULL
		 AND v.scheduled_publish_at > 0 AND v.scheduled_publish_at <= ?`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]VersionRecord, 0, 4)
	for rows.Next() {
		record, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, record)
	}
	return items, rows.Err()
}

// GrayAutoVersions 返回仍处于灰度递增过程中的已发布
// 版本。
func (s *Store) GrayAutoVersions(ctx context.Context) ([]VersionRecord, error) {
	rows, err := s.Reader.QueryContext(ctx,
		versionSelect+` WHERE v.status = 'published' AND v.gray_auto_increment = 1
		 AND v.gray_percent < 100 AND v.publish_time IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]VersionRecord, 0, 4)
	for rows.Next() {
		record, err := scanVersion(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, record)
	}
	return items, rows.Err()
}

func (s *Store) SetGrayPercent(ctx context.Context, id int64, percent int) error {
	_, err := s.Writer.ExecContext(ctx,
		`UPDATE app_versions SET gray_percent = ?, updated_at = ? WHERE id = ?`,
		clampPercent(percent), NowMS(), id)
	return err
}

func (s *Store) InsertUpgradeEvent(ctx context.Context, req model.ReportEventRequest, versionID *int64) error {
	_, err := s.Writer.ExecContext(ctx,
		`INSERT INTO app_upgrade_events
		   (app_key, version_id, device_id, from_version_code, to_version_code, event, fail_code,
		    network_type, os_version, device_model, cost_ms, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		req.AppKey, versionID, truncate(req.DeviceID, 128), req.FromVersionCode, req.ToVersionCode,
		req.Event, truncate(req.FailCode, 64), truncate(req.NetworkType, 16),
		truncate(req.OSVersion, 32), truncate(req.DeviceModel, 64), req.CostMS, NowMS())
	return err
}

// Funnel 在时间窗口内按目标版本聚合升级事件。
func (s *Store) Funnel(ctx context.Context, appKey string, startMS, endMS int64) (model.FunnelResult, error) {
	result := model.FunnelResult{AppKey: appKey, Items: []model.FunnelVersion{}}
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT to_version_code, event, COUNT(1)
		 FROM app_upgrade_events
		 WHERE app_key = ? AND created_at BETWEEN ? AND ?
		 GROUP BY to_version_code, event`, appKey, startMS, endMS)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	byVersion := map[int64]map[string]int{}
	for rows.Next() {
		var (
			versionCode sql.NullInt64
			event       string
			count       int
		)
		if err := rows.Scan(&versionCode, &event, &count); err != nil {
			return result, err
		}
		if event == "check_no_update" {
			result.CheckNoUpdateTotal += count
			continue
		}
		if !versionCode.Valid || versionCode.Int64 <= 0 {
			continue
		}
		events := byVersion[versionCode.Int64]
		if events == nil {
			events = map[string]int{}
			byVersion[versionCode.Int64] = events
		}
		events[event] = count
	}

	names, err := s.versionNames(ctx, appKey)
	if err != nil {
		return result, err
	}
	codes := make([]int64, 0, len(byVersion))
	for code := range byVersion {
		codes = append(codes, code)
	}
	sort.Slice(codes, func(i, j int) bool { return codes[i] > codes[j] })
	for _, code := range codes {
		result.Items = append(result.Items, model.FunnelVersion{
			ToVersionCode: code,
			VersionName:   names[code],
			Events:        byVersion[code],
		})
	}
	return result, rows.Err()
}

func (s *Store) versionNames(ctx context.Context, appKey string) (map[int64]string, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT v.version_code, v.version_name FROM app_versions v JOIN apps a ON a.id = v.app_id
		 WHERE a.app_key = ?`, appKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	names := map[int64]string{}
	for rows.Next() {
		var code int64
		var name string
		if err := rows.Scan(&code, &name); err != nil {
			return nil, err
		}
		names[code] = name
	}
	return names, rows.Err()
}

// CountUpgradeEventsByApp 统计某个应用 key 记录的事件数。
func (s *Store) CountUpgradeEventsByApp(ctx context.Context, appKey string) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx,
		"SELECT COUNT(1) FROM app_upgrade_events WHERE app_key = ?", appKey).Scan(&n)
	return n, err
}

func (s *Store) CountVersions(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM app_versions").Scan(&n)
	return n, err
}

func (s *Store) CountUpgradeEvents(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM app_upgrade_events").Scan(&n)
	return n, err
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
