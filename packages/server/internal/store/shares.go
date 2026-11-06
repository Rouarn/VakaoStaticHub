package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
)

// ShareRecord 是分享链接及其不会离开服务端的机密字段。
type ShareRecord struct {
	model.ShareLink
	PasswordHash string
	UpdatedAt    time.Time
}

type ShareFilter struct {
	Query    string
	Status   string
	Page     int
	PageSize int
}

type ShareUpdate struct {
	Remark       *string
	Enabled      *bool
	ExpiresAt    *int64 // 0 表示清除过期时间
	MaxAccesses  *int   // nil 表示保持，0 表示清除
	PasswordHash *string
}

func (s *Store) CreateShare(ctx context.Context, share ShareRecord) (ShareRecord, error) {
	paths, err := json.Marshal(share.FilePaths)
	if err != nil {
		return ShareRecord{}, err
	}
	now := NowMS()
	enabled := 0
	if share.Enabled {
		enabled = 1
	}
	var expires any
	if share.ExpiresAt != nil {
		expires = share.ExpiresAt.UnixMilli()
	}
	var maxAccesses any
	if share.MaxAccesses != nil {
		maxAccesses = *share.MaxAccesses
	}
	var passwordHash any
	if share.PasswordHash != "" {
		passwordHash = share.PasswordHash
	}
	if _, err := s.Writer.ExecContext(ctx,
		`INSERT INTO share_links
		   (token, root_id, category, file_paths, remark, enabled, expires_at, max_accesses,
		    password_hash, access_count, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		share.Token, share.RootID, share.Category, string(paths), share.Remark, enabled,
		expires, maxAccesses, passwordHash, now, now); err != nil {
		return ShareRecord{}, err
	}
	return s.ShareByToken(ctx, share.Token)
}

func (s *Store) ShareByToken(ctx context.Context, token string) (ShareRecord, error) {
	row := s.Reader.QueryRowContext(ctx,
		`SELECT id, token, root_id, category, file_paths, remark, enabled, expires_at, max_accesses,
		        COALESCE(password_hash, ''), access_count, created_at, updated_at
		 FROM share_links WHERE token = ?`, token)
	record, err := scanShare(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShareRecord{}, ErrNotFound
	}
	return record, err
}

func (s *Store) ShareByID(ctx context.Context, id int64) (ShareRecord, error) {
	row := s.Reader.QueryRowContext(ctx,
		`SELECT id, token, root_id, category, file_paths, remark, enabled, expires_at, max_accesses,
		        COALESCE(password_hash, ''), access_count, created_at, updated_at
		 FROM share_links WHERE id = ?`, id)
	record, err := scanShare(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShareRecord{}, ErrNotFound
	}
	return record, err
}

func scanShare(row rowScanner) (ShareRecord, error) {
	var (
		record      ShareRecord
		pathsJSON   string
		enabled     int
		expiresAt   sql.NullInt64
		maxAccesses sql.NullInt64
		createdAt   int64
		updatedAt   int64
	)
	if err := row.Scan(&record.ID, &record.Token, &record.RootID, &record.Category, &pathsJSON,
		&record.Remark, &enabled, &expiresAt, &maxAccesses, &record.PasswordHash,
		&record.AccessCount, &createdAt, &updatedAt); err != nil {
		return ShareRecord{}, err
	}
	if err := json.Unmarshal([]byte(pathsJSON), &record.FilePaths); err != nil {
		record.FilePaths = []string{}
	}
	if record.FilePaths == nil {
		record.FilePaths = []string{}
	}
	record.Enabled = enabled == 1
	if expiresAt.Valid && expiresAt.Int64 > 0 {
		record.ExpiresAt = NullTime(&expiresAt.Int64)
	}
	if maxAccesses.Valid {
		value := int(maxAccesses.Int64)
		record.MaxAccesses = &value
	}
	record.Password = record.PasswordHash != ""
	record.CreatedAt = Time(createdAt)
	record.UpdatedAt = Time(updatedAt)
	record.Status = ShareStatus(record.ShareLink, time.Now())
	return record, nil
}

// ShareStatus 根据存储的标记推导用户可见状态。
func ShareStatus(link model.ShareLink, now time.Time) string {
	switch {
	case !link.Enabled:
		return "disabled"
	case link.ExpiresAt != nil && !link.ExpiresAt.After(now):
		return "expired"
	case link.MaxAccesses != nil && *link.MaxAccesses > 0 && link.AccessCount >= *link.MaxAccesses:
		return "exhausted"
	default:
		return "active"
	}
}

func (s *Store) ListShares(ctx context.Context, filter ShareFilter) ([]ShareRecord, int, error) {
	where := []string{"1 = 1"}
	args := []any{}
	if filter.Query != "" {
		where = append(where, "(token LIKE ? OR remark LIKE ? OR category LIKE ?)")
		like := "%" + filter.Query + "%"
		args = append(args, like, like, like)
	}
	switch filter.Status {
	case "active":
		where = append(where, "enabled = 1 AND (expires_at IS NULL OR expires_at > ?) AND (max_accesses IS NULL OR max_accesses = 0 OR access_count < max_accesses)")
		args = append(args, NowMS())
	case "disabled":
		where = append(where, "enabled = 0")
	case "expired":
		where = append(where, "enabled = 1 AND expires_at IS NOT NULL AND expires_at <= ?")
		args = append(args, NowMS())
	case "exhausted":
		where = append(where, "enabled = 1 AND (expires_at IS NULL OR expires_at > ?) AND max_accesses IS NOT NULL AND max_accesses > 0 AND access_count >= max_accesses")
		args = append(args, NowMS())
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM share_links"+clause, args...).Scan(&total); err != nil {
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
		`SELECT id, token, root_id, category, file_paths, remark, enabled, expires_at, max_accesses,
		        COALESCE(password_hash, ''), access_count, created_at, updated_at
		 FROM share_links`+clause+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]ShareRecord, 0, pageSize)
	for rows.Next() {
		record, err := scanShare(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, record)
	}
	return items, total, rows.Err()
}

func (s *Store) UpdateShare(ctx context.Context, token string, update ShareUpdate) error {
	sets := []string{"updated_at = ?"}
	args := []any{NowMS()}
	if update.Remark != nil {
		sets = append(sets, "remark = ?")
		args = append(args, *update.Remark)
	}
	if update.Enabled != nil {
		sets = append(sets, "enabled = ?")
		value := 0
		if *update.Enabled {
			value = 1
		}
		args = append(args, value)
	}
	if update.ExpiresAt != nil {
		if *update.ExpiresAt <= 0 {
			sets = append(sets, "expires_at = NULL")
		} else {
			sets = append(sets, "expires_at = ?")
			args = append(args, *update.ExpiresAt)
		}
	}
	if update.MaxAccesses != nil {
		if *update.MaxAccesses <= 0 {
			sets = append(sets, "max_accesses = NULL")
		} else {
			sets = append(sets, "max_accesses = ?")
			args = append(args, *update.MaxAccesses)
		}
	}
	if update.PasswordHash != nil {
		if *update.PasswordHash == "" {
			sets = append(sets, "password_hash = NULL")
		} else {
			sets = append(sets, "password_hash = ?")
			args = append(args, *update.PasswordHash)
		}
	}
	args = append(args, token)
	result, err := s.Writer.ExecContext(ctx,
		"UPDATE share_links SET "+strings.Join(sets, ", ")+" WHERE token = ?", args...)
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

func (s *Store) DeleteShare(ctx context.Context, token string) error {
	result, err := s.Writer.ExecContext(ctx, "DELETE FROM share_links WHERE token = ?", token)
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

// DeleteExpiredShares 删除已过期或访问次数已用尽的分享链接。
// 关联的访问日志依赖 share_access_logs 的级联外键一并删除
// （连接已启用 foreign_keys）。max_accesses 为空或 0 表示
// 不限次数，不会被清理。
func (s *Store) DeleteExpiredShares(ctx context.Context, nowMS int64) (int64, error) {
	result, err := s.Writer.ExecContext(ctx,
		`DELETE FROM share_links
		 WHERE (expires_at IS NOT NULL AND expires_at < ?)
		    OR (max_accesses IS NOT NULL AND max_accesses > 0 AND access_count >= max_accesses)`,
		nowMS)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (s *Store) IncrementShareAccess(ctx context.Context, id int64) error {
	_, err := s.Writer.ExecContext(ctx,
		"UPDATE share_links SET access_count = access_count + 1, updated_at = ? WHERE id = ?",
		NowMS(), id)
	return err
}

func (s *Store) InsertShareAccessLog(ctx context.Context, shareID int64, ip, userAgent string, success bool) error {
	value := 0
	if success {
		value = 1
	}
	_, err := s.Writer.ExecContext(ctx,
		`INSERT INTO share_access_logs (share_id, ip, user_agent, success, created_at)
		 VALUES (?, ?, ?, ?, ?)`, shareID, truncate(ip, 64), truncate(userAgent, 512), value, NowMS())
	return err
}

func (s *Store) ListShareAccessLogs(ctx context.Context, shareID int64, page, pageSize int) ([]model.ShareAccessLog, int, error) {
	var total int
	if err := s.Reader.QueryRowContext(ctx,
		"SELECT COUNT(1) FROM share_access_logs WHERE share_id = ?", shareID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT id, ip, user_agent, success, created_at
		 FROM share_access_logs WHERE share_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		shareID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.ShareAccessLog, 0, pageSize)
	for rows.Next() {
		var (
			item      model.ShareAccessLog
			success   int
			createdAt int64
		)
		if err := rows.Scan(&item.ID, &item.IP, &item.UserAgent, &success, &createdAt); err != nil {
			return nil, 0, err
		}
		item.Success = success == 1
		item.CreatedAt = Time(createdAt)
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func (s *Store) CountShares(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM share_links").Scan(&n)
	return n, err
}

// ShareStatusCounts 使用与 ShareStatus 相同的优先级返回
// 互斥计数：已停用、已过期、已耗尽、有效。
func (s *Store) ShareStatusCounts(ctx context.Context, nowMS int64) (model.ShareCounts, error) {
	var counts model.ShareCounts
	err := s.Reader.QueryRowContext(ctx,
		`SELECT COUNT(1),
		        COALESCE(SUM(CASE WHEN enabled = 1 AND (expires_at IS NULL OR expires_at > ?)
		            AND (max_accesses IS NULL OR max_accesses = 0 OR access_count < max_accesses)
		            THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN enabled = 1 AND expires_at IS NOT NULL AND expires_at <= ?
		            THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN enabled = 1 AND (expires_at IS NULL OR expires_at > ?)
		            AND max_accesses IS NOT NULL AND max_accesses > 0 AND access_count >= max_accesses
		            THEN 1 ELSE 0 END), 0),
		        COALESCE(SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END), 0)
		 FROM share_links`, nowMS, nowMS, nowMS).Scan(
		&counts.All, &counts.Active, &counts.Expired, &counts.Exhausted, &counts.Disabled)
	return counts, err
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
