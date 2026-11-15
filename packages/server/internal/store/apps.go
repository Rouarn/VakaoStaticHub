package store

import (
	"context"
	"database/sql"
	"errors"

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

// VersionFilter 是版本列表条件。Status 支持 draft/published/offline，
// 以及聚合值 gray（已发布且灰度 <100）与 full（灰度 =100）。
type VersionFilter struct {
	AppKey   string
	Platform string
	Status   string
	Page     int
	PageSize int
}

// VersionUpdate 是版本的部分更新：nil 字段保持原值，
// ScheduledAt 为 0 表示清除定时发布。
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

// ListApps 返回全部应用，按 appKey + 平台排序。
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

// AppByKey 按 appKey + 平台读取应用及其内部 id；不存在返回 ErrNotFound。
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

// CreateApp 插入应用；平台为空时按 android 处理，名称保持调用方给的值。
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

// UpdateAppName 修改展示名称；应用不存在返回 ErrNotFound。
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

// DeleteApp 删除应用记录；版本与事件依赖外键级联清理，
// 安装包文件由调用方另行删除。
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
