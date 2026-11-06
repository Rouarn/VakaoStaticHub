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
		        COALESCE(content_hash, ''), created_at, updated_at
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
		        COALESCE(content_hash, ''), created_at, updated_at
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
		&entry.Extension, &entry.Size, &mtimeMS, &entry.ContentHash, &createdAt, &updatedAt); err != nil {
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

// ReplaceRootIndex 使某个根目录的索引与扫描结果保持一致。
// 已消失的条目会被删除；更新时保留已有 id。
func (s *Store) ReplaceRootIndex(ctx context.Context, rootID string, entries []model.FileEntry) (indexed, removed int, err error) {
	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback()

	existing := make(map[string]struct{}, len(entries))
	rows, err := tx.QueryContext(ctx,
		"SELECT category, rel_path FROM file_entries WHERE root_id = ?", rootID)
	if err != nil {
		return 0, 0, err
	}
	for rows.Next() {
		var category, relPath string
		if err := rows.Scan(&category, &relPath); err != nil {
			rows.Close()
			return 0, 0, err
		}
		existing[category+"/"+relPath] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, 0, err
	}
	rows.Close()

	now := NowMS()
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO file_entries
		   (root_id, category, rel_path, name, extension, size, mtime_ms, content_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(root_id, category, rel_path) DO UPDATE SET
		   name = excluded.name,
		   extension = excluded.extension,
		   size = excluded.size,
		   mtime_ms = excluded.mtime_ms,
		   content_hash = excluded.content_hash,
		   updated_at = excluded.updated_at`)
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()

	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		key := entry.Category + "/" + entry.RelPath
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if _, err := stmt.ExecContext(ctx, rootID, entry.Category, entry.RelPath, entry.Name,
			entry.Extension, entry.Size, entry.MTime.UnixMilli(), entry.ContentHash, now, now); err != nil {
			return 0, 0, err
		}
		indexed++
	}

	deleteStmt, err := tx.PrepareContext(ctx,
		"DELETE FROM file_entries WHERE root_id = ? AND category = ? AND rel_path = ?")
	if err != nil {
		return 0, 0, err
	}
	defer deleteStmt.Close()
	for key := range existing {
		if _, ok := seen[key]; ok {
			continue
		}
		category, relPath, _ := strings.Cut(key, "/")
		if _, err := deleteStmt.ExecContext(ctx, rootID, category, relPath); err != nil {
			return 0, 0, err
		}
		removed++
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return indexed, removed, nil
}

func (s *Store) UpsertFile(ctx context.Context, entry model.FileEntry) (model.FileEntry, error) {
	now := NowMS()
	_, err := s.Writer.ExecContext(ctx,
		`INSERT INTO file_entries
		   (root_id, category, rel_path, name, extension, size, mtime_ms, content_hash, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(root_id, category, rel_path) DO UPDATE SET
		   name = excluded.name,
		   extension = excluded.extension,
		   size = excluded.size,
		   mtime_ms = excluded.mtime_ms,
		   content_hash = excluded.content_hash,
		   updated_at = excluded.updated_at`,
		entry.RootID, entry.Category, entry.RelPath, entry.Name, entry.Extension,
		entry.Size, entry.MTime.UnixMilli(), entry.ContentHash, now, now)
	if err != nil {
		return model.FileEntry{}, err
	}
	saved, err := s.FileByPath(ctx, entry.RootID, entry.Category, entry.RelPath)
	if err != nil {
		return model.FileEntry{}, err
	}
	return *saved, nil
}

func (s *Store) DeleteFileEntry(ctx context.Context, rootID, category, relPath string) error {
	_, err := s.Writer.ExecContext(ctx,
		"DELETE FROM file_entries WHERE root_id = ? AND category = ? AND rel_path = ?",
		rootID, category, relPath)
	return err
}

func (s *Store) MoveFileEntry(ctx context.Context, rootID, category, relPath, targetCategory, targetRelPath string) error {
	_, err := s.Writer.ExecContext(ctx,
		`UPDATE file_entries SET category = ?, rel_path = ?, name = ?, updated_at = ?
		 WHERE root_id = ? AND category = ? AND rel_path = ?`,
		targetCategory, targetRelPath, baseName(targetRelPath), NowMS(), rootID, category, relPath)
	return err
}

func (s *Store) RenameCategory(ctx context.Context, rootID, name, newName string) error {
	_, err := s.Writer.ExecContext(ctx,
		"UPDATE file_entries SET category = ?, updated_at = ? WHERE root_id = ? AND category = ?",
		newName, NowMS(), rootID, name)
	return err
}

func (s *Store) DeleteCategoryEntries(ctx context.Context, rootID, name string) error {
	_, err := s.Writer.ExecContext(ctx,
		"DELETE FROM file_entries WHERE root_id = ? AND category = ?", rootID, name)
	return err
}

func (s *Store) DeleteRootEntries(ctx context.Context, rootID string) error {
	_, err := s.Writer.ExecContext(ctx, "DELETE FROM file_entries WHERE root_id = ?", rootID)
	return err
}

func (s *Store) CategoryStats(ctx context.Context, rootID string) ([]model.CategoryInfo, error) {
	query := `SELECT category, COUNT(1), COALESCE(SUM(size), 0)
		 FROM file_entries WHERE root_id = ?`
	args := []any{rootID}
	if clause, clauseArgs := hidePackageCategory(rootID); clause != "" {
		query += " AND " + clause
		args = append(args, clauseArgs...)
	}
	query += " GROUP BY category ORDER BY category"
	rows, err := s.Reader.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make([]model.CategoryInfo, 0, 8)
	for rows.Next() {
		var item model.CategoryInfo
		if err := rows.Scan(&item.Name, &item.FileCount, &item.TotalSize); err != nil {
			return nil, err
		}
		stats = append(stats, item)
	}
	return stats, rows.Err()
}

func (s *Store) StorageStats(ctx context.Context) ([]model.StorageStat, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT f.root_id, COALESCE(r.name, f.root_id), f.category, COUNT(1), COALESCE(SUM(f.size), 0)
		 FROM file_entries f LEFT JOIN resource_roots r ON r.id = f.root_id
		 WHERE NOT (f.root_id = ? AND f.category = ?)
		 GROUP BY f.root_id, f.category
		 ORDER BY f.root_id, f.category`, DefaultRootID, PackageCategoryName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := make([]model.StorageStat, 0, 16)
	for rows.Next() {
		var item model.StorageStat
		if err := rows.Scan(&item.RootID, &item.RootName, &item.Category, &item.FileCount, &item.TotalSize); err != nil {
			return nil, err
		}
		stats = append(stats, item)
	}
	return stats, rows.Err()
}

func (s *Store) DuplicateGroups(ctx context.Context, rootID string, page, pageSize int) ([]model.DuplicateGroup, int, error) {
	where := "content_hash <> '' AND NOT (root_id = ? AND category = ?)"
	args := []any{DefaultRootID, PackageCategoryName}
	if rootID != "" {
		where += " AND root_id = ?"
		args = append(args, rootID)
	}

	var total int
	if err := s.Reader.QueryRowContext(ctx,
		"SELECT COUNT(1) FROM (SELECT 1 FROM file_entries WHERE "+where+
			" GROUP BY content_hash, size HAVING COUNT(1) > 1)", args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT content_hash, size, COUNT(1) FROM file_entries WHERE `+where+
			` GROUP BY content_hash, size HAVING COUNT(1) > 1
			 ORDER BY size DESC, content_hash LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	groups := make([]model.DuplicateGroup, 0, pageSize)
	for rows.Next() {
		var group model.DuplicateGroup
		if err := rows.Scan(&group.Hash, &group.Size, &group.Count); err != nil {
			return nil, 0, err
		}
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	for i := range groups {
		files, err := s.duplicateFiles(ctx, groups[i].Hash, groups[i].Size)
		if err != nil {
			return nil, 0, err
		}
		groups[i].Files = files
	}
	return groups, total, nil
}

func (s *Store) duplicateFiles(ctx context.Context, hash string, size int64) ([]model.DuplicateFile, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT id, root_id, category, rel_path, name, size, mtime_ms
		 FROM file_entries
		 WHERE content_hash = ? AND size = ? AND NOT (root_id = ? AND category = ?)
		 ORDER BY root_id, category, rel_path`,
		hash, size, DefaultRootID, PackageCategoryName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	files := make([]model.DuplicateFile, 0, 4)
	for rows.Next() {
		var (
			file    model.DuplicateFile
			mtimeMS int64
		)
		if err := rows.Scan(&file.ID, &file.RootID, &file.Category, &file.RelPath, &file.Name, &file.Size, &mtimeMS); err != nil {
			return nil, err
		}
		file.MTime = Time(mtimeMS)
		files = append(files, file)
	}
	return files, rows.Err()
}

func baseName(path string) string {
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		return path[idx+1:]
	}
	return path
}

func (s *Store) CountFiles(ctx context.Context) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx, "SELECT COUNT(1) FROM file_entries").Scan(&n)
	return n, err
}

// randomImageExtensions 与旧版随机图池保持一致。
// tif 是 tiff 的常见别名，缩略图同样支持。
var randomImageExtensions = []string{"jpg", "jpeg", "png", "gif", "webp", "avif", "tiff", "tif"}

// imagePoolConditions 构造随机图池的过滤条件。
// rootID / category 为空时不收窄范围。
func imagePoolConditions(rootID, category string) ([]string, []any) {
	where := []string{"LOWER(extension) IN (?, ?, ?, ?, ?, ?, ?, ?)"}
	args := make([]any, 0, len(randomImageExtensions)+2)
	for _, extension := range randomImageExtensions {
		args = append(args, extension)
	}
	if rootID != "" {
		where = append(where, "root_id = ?")
		args = append(args, rootID)
	}
	if category != "" {
		where = append(where, "category = ?")
		args = append(args, category)
	}
	return where, args
}

// ImageIDs 返回随机图池内的图片记录 id，按 id 升序。
// 调用方可用它判断池成员是否发生变化。
func (s *Store) ImageIDs(ctx context.Context, rootID, category string) ([]int64, error) {
	where, args := imagePoolConditions(rootID, category)
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT id FROM file_entries WHERE `+strings.Join(where, " AND ")+` ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]int64, 0, 64)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// FileByID 按主键读取一条文件记录。
func (s *Store) FileByID(ctx context.Context, id int64) (model.FileEntry, error) {
	entry, err := scanFileEntry(s.Reader.QueryRowContext(ctx,
		`SELECT id, root_id, category, rel_path, name, extension, size, mtime_ms,
		        COALESCE(content_hash, ''), created_at, updated_at
		 FROM file_entries WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.FileEntry{}, ErrNotFound
	}
	return entry, err
}
