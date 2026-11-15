package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"vakao-static-hub/server/internal/model"
)

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

// UpsertFile 写入或更新单条文件记录，并返回库中的最终状态。
// 短码会按新内容与路径重新解析；已有记录的 created_at 保持不变。
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

// DeleteFileEntry 删除单条索引记录；记录不存在不视为错误。
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

// DeleteCategoryEntries 删除某分类下的全部索引记录，不触碰磁盘文件。
func (s *Store) DeleteCategoryEntries(ctx context.Context, rootID, name string) error {
	_, err := s.Writer.ExecContext(ctx,
		"DELETE FROM file_entries WHERE root_id = ? AND category = ?", rootID, name)
	return err
}

// DeleteRootEntries 删除某根目录下的全部索引记录，不触碰磁盘文件。
func (s *Store) DeleteRootEntries(ctx context.Context, rootID string) error {
	_, err := s.Writer.ExecContext(ctx, "DELETE FROM file_entries WHERE root_id = ?", rootID)
	return err
}

func baseName(path string) string {
	if idx := strings.LastIndex(path, "/"); idx >= 0 {
		return path[idx+1:]
	}
	return path
}
