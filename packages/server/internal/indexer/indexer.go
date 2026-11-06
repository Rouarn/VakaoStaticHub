package indexer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

// Indexer 遍历所有资源根目录，使 file_entries 与磁盘保持一致。
// 它是索引的唯一写入方；HTTP 处理函数只更新单行记录。
type Indexer struct {
	store *store.Store
}

func New(st *store.Store) *Indexer {
	return &Indexer{store: st}
}

func (ix *Indexer) ScanAll(ctx context.Context) (model.FileIndexResult, error) {
	started := time.Now()
	roots, err := ix.store.ListRoots(ctx)
	if err != nil {
		return model.FileIndexResult{}, err
	}
	var result model.FileIndexResult
	for _, root := range roots {
		indexed, removed, err := ix.ScanRoot(ctx, root)
		if err != nil {
			return model.FileIndexResult{}, err
		}
		result.Indexed += indexed
		result.Removed += removed
	}
	result.DurationMS = time.Since(started).Milliseconds()
	return result, nil
}

func (ix *Indexer) ScanRoot(ctx context.Context, root model.ResourceRoot) (indexed, removed int, err error) {
	metas, err := ix.store.FileMetas(ctx, root.ID)
	if err != nil {
		return 0, 0, err
	}
	entries, err := scanRootDirectory(root)
	if err != nil {
		return 0, 0, err
	}
	for i := range entries {
		key := entries[i].Category + "/" + entries[i].RelPath
		meta, ok := metas[key]
		if ok && meta.Size == entries[i].Size && meta.MTimeMS == entries[i].MTime.UnixMilli() && meta.ContentHash != "" {
			entries[i].ContentHash = meta.ContentHash
			continue
		}
		hash, err := hashFile(filepath.Join(root.Path, entries[i].Category, filepath.FromSlash(entries[i].RelPath)))
		if err != nil {
			// 无法读取的文件仍会保留索引但不带哈希；提供该文件时
			// 仍会返回有用的错误。
			entries[i].ContentHash = ""
			continue
		}
		entries[i].ContentHash = hash
	}
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	return ix.store.ReplaceRootIndex(ctx, root.ID, entries)
}

// scanRootDirectory 为每个普通文件返回一条记录。分类即
// 第一层目录，其下所有层级都属于 rel_path。
func scanRootDirectory(root model.ResourceRoot) ([]model.FileEntry, error) {
	top, err := os.ReadDir(root.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	entries := make([]model.FileEntry, 0, 256)
	for _, categoryEntry := range top {
		if !categoryEntry.IsDir() || strings.HasPrefix(categoryEntry.Name(), ".") {
			continue
		}
		category := categoryEntry.Name()
		categoryDir := filepath.Join(root.Path, category)
		walkErr := filepath.WalkDir(categoryDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				if errors.Is(err, fs.ErrPermission) {
					return fs.SkipDir
				}
				return err
			}
			if d.IsDir() {
				if path != categoryDir && strings.HasPrefix(d.Name(), ".") {
					return fs.SkipDir
				}
				return nil
			}
			if !d.Type().IsRegular() || strings.HasPrefix(d.Name(), ".") {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return nil
			}
			rel, err := filepath.Rel(categoryDir, path)
			if err != nil {
				return nil
			}
			ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(d.Name())), ".")
			entries = append(entries, model.FileEntry{
				RootID:    root.ID,
				Category:  category,
				RelPath:   filepath.ToSlash(rel),
				Name:      d.Name(),
				Extension: ext,
				Size:      info.Size(),
				MTime:     info.ModTime(),
			})
			return nil
		})
		if walkErr != nil {
			return nil, walkErr
		}
	}
	return entries, nil
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
