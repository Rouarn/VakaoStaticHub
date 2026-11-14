package store

import (
	"context"
	"strings"

	"vakao-static-hub/server/internal/model"
)

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
