package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"vakao-static-hub/server/internal/model"
)

var (
	ErrNotFound = errors.New("record not found")
	ErrConflict = errors.New("record already exists")
)

// UserRecord 携带密码哈希，且从不直接序列化。
type UserRecord struct {
	model.User
	PasswordHash string
	UpdatedAtMS  int64
}

// CountUsers 返回用户总数。
func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM users").Scan(&n)
	return n, err
}

// CountAdmins 返回管理员数量，用于阻止删除最后一个管理员。
func (s *Store) CountAdmins(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx,
		"SELECT COUNT(1) FROM users WHERE role = 'admin'").Scan(&n)
	return n, err
}

// CreateUser 插入用户并返回不含密码哈希的记录；用户名冲突返回 ErrConflict。
func (s *Store) CreateUser(ctx context.Context, username, passwordHash, role string) (model.User, error) {
	now := NowMS()
	res, err := s.Writer.ExecContext(ctx,
		`INSERT INTO users (username, password_hash, role, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		username, passwordHash, role, now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return model.User{}, ErrConflict
		}
		return model.User{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return model.User{}, err
	}
	return model.User{
		ID:        id,
		Username:  username,
		Role:      role,
		CreatedAt: Time(now),
		UpdatedAt: Time(now),
	}, nil
}

// UserByUsername 读取含密码哈希的记录，供登录校验使用；
// 不存在返回 ErrNotFound。
func (s *Store) UserByUsername(ctx context.Context, username string) (*UserRecord, error) {
	row := s.Reader.QueryRowContext(ctx,
		`SELECT id, username, password_hash, role, created_at, updated_at
		 FROM users WHERE username = ?`, username)
	return scanUserRecord(row)
}

// UserByID 按主键读取用户（含密码哈希与 updatedAt 毫秒值，
// 后者用于令牌失效判断）；不存在返回 ErrNotFound。
func (s *Store) UserByID(ctx context.Context, id int64) (*UserRecord, error) {
	row := s.Reader.QueryRowContext(ctx,
		`SELECT id, username, password_hash, role, created_at, updated_at
		 FROM users WHERE id = ?`, id)
	return scanUserRecord(row)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUserRecord(row rowScanner) (*UserRecord, error) {
	var (
		rec       UserRecord
		createdAt int64
	)
	if err := row.Scan(&rec.ID, &rec.Username, &rec.PasswordHash, &rec.Role, &createdAt, &rec.UpdatedAtMS); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rec.CreatedAt = Time(createdAt)
	rec.UpdatedAt = Time(rec.UpdatedAtMS)
	return &rec, nil
}

// ListUsers 返回一页用户（不含密码哈希），query 对用户名做模糊匹配。
func (s *Store) ListUsers(ctx context.Context, page, pageSize int, query string) ([]model.User, int, error) {
	where := ""
	args := make([]any, 0, 2)
	if query != "" {
		where = " WHERE username LIKE ?"
		args = append(args, "%"+query+"%")
	}
	var total int
	if err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM users"+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT id, username, role, created_at, updated_at FROM users`+where+
			` ORDER BY id LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.User, 0, pageSize)
	for rows.Next() {
		var (
			u         model.User
			createdAt int64
			updatedAt int64
		)
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &createdAt, &updatedAt); err != nil {
			return nil, 0, err
		}
		u.CreatedAt = Time(createdAt)
		u.UpdatedAt = Time(updatedAt)
		items = append(items, u)
	}
	return items, total, rows.Err()
}

// UpdatePassword 写入新的密码哈希并推进 updated_at，
// 从而让该用户此前签发的令牌全部失效；用户不存在返回 ErrNotFound。
func (s *Store) UpdatePassword(ctx context.Context, id int64, passwordHash string) error {
	res, err := s.Writer.ExecContext(ctx,
		"UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
		passwordHash, NowMS(), id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteUser 删除用户；不存在返回 ErrNotFound。是否允许删除
// （例如最后一个管理员）由调用方判断。
func (s *Store) DeleteUser(ctx context.Context, id int64) error {
	res, err := s.Writer.ExecContext(ctx, "DELETE FROM users WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || strings.Contains(msg, "constraint failed: unique")
}
