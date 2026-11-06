package store

import (
	"context"
	"encoding/json"
	"strings"

	"vakao-static-hub/server/internal/model"
)

type AuditFilter struct {
	UserID       *int64
	Action       string
	Username     string
	ResourceType string
	Query        string
	StartMS      int64
	EndMS        int64
	Page         int
	PageSize     int
}

func (s *Store) InsertAudit(ctx context.Context, entry model.AuditLog) error {
	details := "{}"
	if entry.Details != nil {
		body, err := json.Marshal(entry.Details)
		if err != nil {
			return err
		}
		details = string(body)
	}
	createdAt := MS(entry.CreatedAt)
	if createdAt == 0 {
		createdAt = NowMS()
	}
	_, err := s.Writer.ExecContext(ctx,
		`INSERT INTO audit_logs
		   (user_id, username, action, resource_type, resource_id, details, ip, user_agent, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.UserID, entry.Username, entry.Action, entry.ResourceType, entry.ResourceID,
		details, truncate(entry.IP, 64), truncate(entry.UserAgent, 512), createdAt)
	return err
}

func (s *Store) ListAudit(ctx context.Context, filter AuditFilter) ([]model.AuditLog, int, error) {
	where := []string{"1 = 1"}
	args := []any{}
	if filter.UserID != nil {
		where = append(where, "user_id = ?")
		args = append(args, *filter.UserID)
	}
	if filter.Action != "" {
		where = append(where, "action = ?")
		args = append(args, filter.Action)
	}
	if filter.Username != "" {
		where = append(where, "username LIKE ?")
		args = append(args, "%"+filter.Username+"%")
	}
	if filter.ResourceType != "" {
		where = append(where, "resource_type = ?")
		args = append(args, filter.ResourceType)
	}
	if filter.Query != "" {
		where = append(where, "(username LIKE ? OR resource_id LIKE ? OR resource_type LIKE ?)")
		like := "%" + filter.Query + "%"
		args = append(args, like, like, like)
	}
	if filter.StartMS > 0 {
		where = append(where, "created_at >= ?")
		args = append(args, filter.StartMS)
	}
	if filter.EndMS > 0 {
		where = append(where, "created_at <= ?")
		args = append(args, filter.EndMS)
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM audit_logs"+clause, args...).Scan(&total); err != nil {
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
		`SELECT id, user_id, username, action, resource_type, resource_id, details, ip, user_agent, created_at
		 FROM audit_logs`+clause+` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.AuditLog, 0, pageSize)
	for rows.Next() {
		var (
			entry     model.AuditLog
			userID    *int64
			details   string
			createdAt int64
		)
		if err := rows.Scan(&entry.ID, &userID, &entry.Username, &entry.Action, &entry.ResourceType,
			&entry.ResourceID, &details, &entry.IP, &entry.UserAgent, &createdAt); err != nil {
			return nil, 0, err
		}
		entry.UserID = userID
		if details != "" {
			_ = json.Unmarshal([]byte(details), &entry.Details)
		}
		entry.CreatedAt = Time(createdAt)
		items = append(items, entry)
	}
	return items, total, rows.Err()
}

func (s *Store) CountAudit(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM audit_logs").Scan(&n)
	return n, err
}
