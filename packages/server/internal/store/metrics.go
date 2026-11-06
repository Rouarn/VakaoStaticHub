package store

import (
	"context"

	"vakao-static-hub/server/internal/model"
)

// StorageTotals 返回已索引文件数量及其总大小。
func (s *Store) StorageTotals(ctx context.Context) (int, int64, error) {
	var (
		count int
		size  int64
	)
	// software-update 同时被默认根与独立根索引，统计时只保留独立根的一份
	err := s.Reader.QueryRowContext(ctx,
		`SELECT COUNT(1), COALESCE(SUM(size), 0) FROM file_entries
		 WHERE NOT (root_id = ? AND category = ?)`, DefaultRootID, PackageCategoryName).Scan(&count, &size)
	return count, size, err
}

// RootMetrics 列出每个资源根目录及其索引统计。
func (s *Store) RootMetrics(ctx context.Context) ([]model.RootMetrics, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT r.id, r.name,
		        COALESCE(COUNT(f.id), 0), COALESCE(SUM(f.size), 0)
		 FROM resource_roots r
		 LEFT JOIN file_entries f
		   ON f.root_id = r.id AND NOT (r.id = ? AND f.category = ?)
		 GROUP BY r.id, r.name
		 ORDER BY CASE WHEN r.id = 'default' THEN 0 ELSE 1 END, r.created_at, r.rowid`,
		DefaultRootID, PackageCategoryName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]model.RootMetrics, 0, 4)
	for rows.Next() {
		var item model.RootMetrics
		if err := rows.Scan(&item.RootID, &item.RootName, &item.FileCount, &item.TotalSize); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// VersionStatusMetrics 按发布状态统计应用版本。
func (s *Store) VersionStatusMetrics(ctx context.Context) (model.VersionStatusMetric, error) {
	var metric model.VersionStatusMetric
	err := s.Reader.QueryRowContext(ctx,
		`SELECT COUNT(1),
		        COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN status = 'published' AND gray_percent < 100 THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN status = 'published' AND gray_percent >= 100 THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN status = 'offline' THEN 1 ELSE 0 END), 0)
		 FROM app_versions`).Scan(
		&metric.Total, &metric.Draft, &metric.Gray, &metric.Published, &metric.Offline)
	return metric, err
}

// UpgradeEventCounts 按事件名统计给定时间之后的事件数。
func (s *Store) UpgradeEventCounts(ctx context.Context, sinceMS int64) (map[string]int, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT event, COUNT(1) FROM app_upgrade_events WHERE created_at >= ? GROUP BY event`,
		sinceMS)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := map[string]int{}
	for rows.Next() {
		var (
			event string
			count int
		)
		if err := rows.Scan(&event, &count); err != nil {
			return nil, err
		}
		counts[event] = count
	}
	return counts, rows.Err()
}
