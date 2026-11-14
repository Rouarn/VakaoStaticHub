package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"vakao-static-hub/server/internal/model"
)

// FileMeta 是判断文件在索引扫描时是否需要
// 重新计算哈希所需的最小记录。
type FileMeta struct {
	Category    string
	RelPath     string
	Size        int64
	MTimeMS     int64
	ContentHash string
}

type FileFilter struct {
	RootID   string
	Category string
	Query    string
	Sort     string
	Order    string
	Page     int
	PageSize int
}

const (
	// DefaultRootID 是默认资源根目录的固定 id。
	DefaultRootID = "default"
	// PackageCategoryName 是默认根下承载 APP 安装包的目录名。
	// 它同时是独立的资源根（software-update），默认根下不再重复展示。
	PackageCategoryName = "software-update"
)

// hidePackageCategory 返回默认根下隐藏软件包分类的 SQL 条件与参数。
// 其他根目录不受影响。
func hidePackageCategory(rootID string) (string, []any) {
	if rootID == DefaultRootID {
		return "category <> ?", []any{PackageCategoryName}
	}
	return "", nil
}

var fileSortColumns = map[string]string{
	"name":    "name",
	"size":    "size",
	"mtime":   "mtime_ms",
	"created": "created_at",
}

func (s *Store) ListFiles(ctx context.Context, filter FileFilter) ([]model.FileEntry, int, error) {
	where := []string{"root_id = ?"}
	args := []any{filter.RootID}
	if clause, clauseArgs := hidePackageCategory(filter.RootID); clause != "" {
		where = append(where, clause)
		args = append(args, clauseArgs...)
	}
	if filter.Category != "" {
		where = append(where, "category = ?")
		args = append(args, filter.Category)
	}
	if filter.Query != "" {
		where = append(where, "(name LIKE ? OR rel_path LIKE ?)")
		like := "%" + filter.Query + "%"
		args = append(args, like, like)
	}
	clause := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.Reader.QueryRowContext(ctx,
		"SELECT COUNT(1) FROM file_entries"+clause, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	column, ok := fileSortColumns[filter.Sort]
	if !ok {
		column = "mtime_ms"
	}
	direction := "DESC"
	if strings.EqualFold(filter.Order, "asc") {
		direction = "ASC"
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := s.Reader.QueryContext(ctx,
		`SELECT id, root_id, category, rel_path, name, extension, size, mtime_ms,
		        COALESCE(content_hash, ''), short_code, created_at, updated_at
		 FROM file_entries`+clause+
			` ORDER BY `+column+` `+direction+`, id LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.FileEntry, 0, pageSize)
	for rows.Next() {
		entry, err := scanFileEntry(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, entry)
	}
	return items, total, rows.Err()
}

func (s *Store) FileByPath(ctx context.Context, rootID, category, relPath string) (*model.FileEntry, error) {
	row := s.Reader.QueryRowContext(ctx,
		`SELECT id, root_id, category, rel_path, name, extension, size, mtime_ms,
		        COALESCE(content_hash, ''), short_code, created_at, updated_at
		 FROM file_entries WHERE root_id = ? AND category = ? AND rel_path = ?`,
		rootID, category, relPath)
	entry, err := scanFileEntry(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &entry, nil
}

func scanFileEntry(row rowScanner) (model.FileEntry, error) {
	var (
		entry     model.FileEntry
		mtimeMS   int64
		createdAt int64
		updatedAt int64
	)
	if err := row.Scan(&entry.ID, &entry.RootID, &entry.Category, &entry.RelPath, &entry.Name,
		&entry.Extension, &entry.Size, &mtimeMS, &entry.ContentHash, &entry.Code,
		&createdAt, &updatedAt); err != nil {
		return model.FileEntry{}, err
	}
	entry.MTime = Time(mtimeMS)
	entry.CreatedAt = Time(createdAt)
	entry.UpdatedAt = Time(updatedAt)
	return entry, nil
}

func (s *Store) FileMetas(ctx context.Context, rootID string) (map[string]FileMeta, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT category, rel_path, size, mtime_ms, COALESCE(content_hash, '')
		 FROM file_entries WHERE root_id = ?`, rootID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metas := make(map[string]FileMeta)
	for rows.Next() {
		var meta FileMeta
		if err := rows.Scan(&meta.Category, &meta.RelPath, &meta.Size, &meta.MTimeMS, &meta.ContentHash); err != nil {
			return nil, err
		}
		metas[meta.Category+"/"+meta.RelPath] = meta
	}
	return metas, rows.Err()
}

func (s *Store) CountFiles(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM file_entries").Scan(&n)
	return n, err
}

// FileByID 按主键读取一条文件记录（随机图池内部使用，不对外暴露路由）。
func (s *Store) FileByID(ctx context.Context, id int64) (model.FileEntry, error) {
	entry, err := scanFileEntry(s.Reader.QueryRowContext(ctx,
		`SELECT id, root_id, category, rel_path, name, extension, size, mtime_ms,
		        COALESCE(content_hash, ''), short_code, created_at, updated_at
		 FROM file_entries WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.FileEntry{}, ErrNotFound
	}
	return entry, err
}

// FileByShortCode 按内容短码读取一条文件记录。短码按记录唯一，命中至多一条。
func (s *Store) FileByShortCode(ctx context.Context, code string) (model.FileEntry, error) {
	entry, err := scanFileEntry(s.Reader.QueryRowContext(ctx,
		`SELECT id, root_id, category, rel_path, name, extension, size, mtime_ms,
		        COALESCE(content_hash, ''), short_code, created_at, updated_at
		 FROM file_entries WHERE short_code = ?`, code))
	if errors.Is(err, sql.ErrNoRows) {
		return model.FileEntry{}, ErrNotFound
	}
	return entry, err
}
