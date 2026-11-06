package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"vakao-static-hub/server/internal/model"
)

// shortCodeLength 是内容短码的基础长度：sha256 十六进制串的前 12 位（48 位空间）。
const shortCodeLength = 12

// shortCodeStep 是撞码时短码的增长步长。
const shortCodeStep = 4

// shortCodeDigest 由「内容 sha256 + 根/分类/相对路径」派生完整摘要。
// 同一份内容出现在不同路径时会得到不同摘要，每条记录一个短码；
// 内容和路径任一变化，短码都会随之变化。
func shortCodeDigest(rootID, category, relPath, contentHash string) string {
	sum := sha256.Sum256([]byte(contentHash + "\x00" + rootID + "\x00" + category + "\x00" + relPath))
	return hex.EncodeToString(sum[:])
}

// shortCodeQuerier 覆盖 *sql.DB 与 *sql.Tx，便于在事务内做撞码检查。
type shortCodeQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// resolveShortCode 为一条记录选一个未被占用的短码。
// 先试 12 位；如果该码已被「内容或路径不同」的记录占用，则每次加 4 位重试，
// 最长到完整 64 位。同一条记录（重扫 / 原地更新）不算占用，可以沿用。
func resolveShortCode(ctx context.Context, q shortCodeQuerier, rootID, category, relPath, contentHash string) (string, error) {
	digest := shortCodeDigest(rootID, category, relPath, contentHash)
	for length := shortCodeLength; ; length += shortCodeStep {
		if length > len(digest) {
			length = len(digest)
		}
		candidate := digest[:length]
		var occupied int
		err := q.QueryRowContext(ctx,
			`SELECT 1 FROM file_entries
			 WHERE short_code = ? AND NOT (root_id = ? AND category = ? AND rel_path = ?)
			 LIMIT 1`,
			candidate, rootID, category, relPath).Scan(&occupied)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return candidate, nil
		case err != nil:
			return "", err
		case length >= len(digest):
			// 64 位全撞只可能发生在完全相同的输入上，上面的同路径分支已兜住
			return "", fmt.Errorf("短码冲突无法消解：%s/%s/%s", rootID, category, relPath)
		}
	}
}

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

	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		seen[entry.Category+"/"+entry.RelPath] = struct{}{}
	}

	// 先删掉已消失的条目，让它们的短码在本次写入时可以被复用。
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

	now := NowMS()
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO file_entries
		   (root_id, category, rel_path, name, extension, size, mtime_ms, content_hash,
		    short_code, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(root_id, category, rel_path) DO UPDATE SET
		   name = excluded.name,
		   extension = excluded.extension,
		   size = excluded.size,
		   mtime_ms = excluded.mtime_ms,
		   content_hash = excluded.content_hash,
		   short_code = excluded.short_code,
		   updated_at = excluded.updated_at`)
	if err != nil {
		return 0, 0, err
	}
	defer stmt.Close()

	written := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		key := entry.Category + "/" + entry.RelPath
		if _, ok := written[key]; ok {
			continue
		}
		written[key] = struct{}{}
		code, err := resolveShortCode(ctx, tx, rootID, entry.Category, entry.RelPath, entry.ContentHash)
		if err != nil {
			return 0, 0, err
		}
		if _, err := stmt.ExecContext(ctx, rootID, entry.Category, entry.RelPath, entry.Name,
			entry.Extension, entry.Size, entry.MTime.UnixMilli(), entry.ContentHash,
			code, now, now); err != nil {
			return 0, 0, err
		}
		indexed++
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return indexed, removed, nil
}

func (s *Store) UpsertFile(ctx context.Context, entry model.FileEntry) (model.FileEntry, error) {
	now := NowMS()
	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return model.FileEntry{}, err
	}
	defer tx.Rollback()
	code, err := resolveShortCode(ctx, tx, entry.RootID, entry.Category, entry.RelPath, entry.ContentHash)
	if err != nil {
		return model.FileEntry{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO file_entries
		   (root_id, category, rel_path, name, extension, size, mtime_ms, content_hash,
		    short_code, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(root_id, category, rel_path) DO UPDATE SET
		   name = excluded.name,
		   extension = excluded.extension,
		   size = excluded.size,
		   mtime_ms = excluded.mtime_ms,
		   content_hash = excluded.content_hash,
		   short_code = excluded.short_code,
		   updated_at = excluded.updated_at`,
		entry.RootID, entry.Category, entry.RelPath, entry.Name, entry.Extension,
		entry.Size, entry.MTime.UnixMilli(), entry.ContentHash,
		code, now, now); err != nil {
		return model.FileEntry{}, err
	}
	if err := tx.Commit(); err != nil {
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

// MoveFileEntry 移动/重命名单条记录，短码含路径，需一并重算。
func (s *Store) MoveFileEntry(ctx context.Context, rootID, category, relPath, targetCategory, targetRelPath string) error {
	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var contentHash string
	err = tx.QueryRowContext(ctx,
		`SELECT COALESCE(content_hash, '') FROM file_entries
		 WHERE root_id = ? AND category = ? AND rel_path = ?`,
		rootID, category, relPath).Scan(&contentHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	code, err := resolveShortCode(ctx, tx, rootID, targetCategory, targetRelPath, contentHash)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE file_entries SET category = ?, rel_path = ?, name = ?, short_code = ?, updated_at = ?
		 WHERE root_id = ? AND category = ? AND rel_path = ?`,
		targetCategory, targetRelPath, baseName(targetRelPath), code, NowMS(),
		rootID, category, relPath); err != nil {
		return err
	}
	return tx.Commit()
}

// RenameCategory 重命名分类：分类参与短码计算，需要逐条重算。
func (s *Store) RenameCategory(ctx context.Context, rootID, name, newName string) error {
	rows, err := s.Writer.QueryContext(ctx,
		`SELECT rel_path, COALESCE(content_hash, '') FROM file_entries
		 WHERE root_id = ? AND category = ?`, rootID, name)
	if err != nil {
		return err
	}
	type categoryEntry struct {
		relPath     string
		contentHash string
	}
	entries := make([]categoryEntry, 0, 64)
	for rows.Next() {
		var item categoryEntry
		if err := rows.Scan(&item.relPath, &item.contentHash); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := NowMS()
	for _, item := range entries {
		// 先改分类，再按新路径解析短码：这样撞码检查不会把这一条自己当成占用者。
		if _, err := tx.ExecContext(ctx,
			`UPDATE file_entries SET category = ?, updated_at = ?
			 WHERE root_id = ? AND category = ? AND rel_path = ?`,
			newName, now, rootID, name, item.relPath); err != nil {
			return err
		}
		code, err := resolveShortCode(ctx, tx, rootID, newName, item.relPath, item.contentHash)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE file_entries SET short_code = ?
			 WHERE root_id = ? AND category = ? AND rel_path = ?`,
			code, rootID, newName, item.relPath); err != nil {
			return err
		}
	}
	return tx.Commit()
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
		`SELECT id, root_id, category, rel_path, name, size, mtime_ms, short_code
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
		if err := rows.Scan(&file.ID, &file.RootID, &file.Category, &file.RelPath, &file.Name,
			&file.Size, &mtimeMS, &file.Code); err != nil {
			return nil, err
		}
		file.MTime = Time(mtimeMS)
		files = append(files, file)
	}
	return files, rows.Err()
}

// ensureShortCodes 为历史数据回填短码，回填完成后再建唯一索引。
// SQLite 没有内置 sha256，只能逐行在 Go 里算；唯一索引也必须等所有行都有码才能建。
func (s *Store) ensureShortCodes(ctx context.Context) error {
	var exists int
	if err := s.Writer.QueryRowContext(ctx,
		`SELECT COUNT(1) FROM sqlite_master
		 WHERE type = 'index' AND name = 'idx_file_entries_short_code' AND sql LIKE '%UNIQUE%'`).
		Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}

	type record struct {
		id          int64
		rootID      string
		category    string
		relPath     string
		contentHash string
	}
	rows, err := s.Writer.QueryContext(ctx,
		`SELECT id, root_id, category, rel_path, COALESCE(content_hash, '') FROM file_entries ORDER BY id`)
	if err != nil {
		return err
	}
	records := make([]record, 0, 4096)
	for rows.Next() {
		var item record
		if err := rows.Scan(&item.id, &item.rootID, &item.category, &item.relPath, &item.contentHash); err != nil {
			rows.Close()
			return err
		}
		records = append(records, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	// 旧版本可能留下同名普通索引，先删掉，避免回填时被旧约束挡住。
	if _, err := s.Writer.ExecContext(ctx, `DROP INDEX IF EXISTS idx_file_entries_short_code`); err != nil {
		return err
	}

	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range records {
		code, err := resolveShortCode(ctx, tx, item.rootID, item.category, item.relPath, item.contentHash)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE file_entries SET short_code = ? WHERE id = ?`, code, item.id); err != nil {
			return err
		}
	}
	// 短码按记录唯一：同一内容散落在不同路径会得到不同的码。
	if _, err := tx.ExecContext(ctx,
		`CREATE UNIQUE INDEX idx_file_entries_short_code ON file_entries(short_code)`); err != nil {
		return err
	}
	return tx.Commit()
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
