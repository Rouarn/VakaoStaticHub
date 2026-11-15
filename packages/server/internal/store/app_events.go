package store

import (
	"context"
	"database/sql"
	"sort"

	"vakao-static-hub/server/internal/model"
)

// InsertUpgradeEvent 记录一条客户端升级事件，versionID 可为 nil
// （客户端尚未确定目标版本时）。文本字段按列宽截断。
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

// CountVersions 返回全部应用版本数。
func (s *Store) CountVersions(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM app_versions").Scan(&n)
	return n, err
}

// CountUpgradeEvents 返回全部升级事件数。
func (s *Store) CountUpgradeEvents(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM app_upgrade_events").Scan(&n)
	return n, err
}
