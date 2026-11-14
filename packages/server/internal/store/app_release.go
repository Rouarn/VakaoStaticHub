package store

import "context"

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
