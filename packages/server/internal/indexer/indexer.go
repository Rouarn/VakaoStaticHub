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

// ProgressFunc 扫描过程中的进度回调：已发现文件数、已写入索引数、当前目录。
// currentDir 为相对根目录的路径（如「摄影/相机」），根目录本身为空字符串。
type ProgressFunc func(scanned, indexed int, currentDir string)

// ScanRootWithProgress 扫描单个根目录，并在遍历与计算哈希时回调进度。
func (ix *Indexer) ScanRootWithProgress(
	ctx context.Context,
	root model.ResourceRoot,
	progress ProgressFunc,
) (indexed, removed int, err error) {
	metas, err := ix.store.FileMetas(ctx, root.ID)
	if err != nil {
		return 0, 0, err
	}
	scanned := 0
	entries, err := scanRootDirectory(root, func(currentDir string) {
		scanned++
		if progress != nil {
			progress(scanned, 0, currentDir)
		}
	})
	if err != nil {
		return 0, 0, err
	}
	for i := range entries {
		key := entries[i].Category + "/" + entries[i].RelPath
		meta, ok := metas[key]
		if ok && meta.Size == entries[i].Size && meta.MTimeMS == entries[i].MTime.UnixMilli() && meta.ContentHash != "" {
			entries[i].ContentHash = meta.ContentHash
			if progress != nil {
				progress(scanned, i+1, entryDir(entries[i]))
			}
			continue
		}
		hash, err := hashFile(filepath.Join(root.Path, entries[i].Category, filepath.FromSlash(entries[i].RelPath)))
		if err != nil {
			// 无法读取的文件仍会保留索引但不带哈希；提供该文件时
			// 仍会返回有用的错误。
			entries[i].ContentHash = ""
		} else {
			entries[i].ContentHash = hash
		}
		if progress != nil {
			progress(scanned, i+1, entryDir(entries[i]))
		}
	}
	if err := ctx.Err(); err != nil {
		return 0, 0, err
	}
	return ix.store.ReplaceRootIndex(ctx, root.ID, entries)
}

// entryDir 返回文件所属目录（相对根目录），用于展示当前扫描位置。
func entryDir(entry model.FileEntry) string {
	rel := entry.RelPath
	if idx := strings.LastIndex(rel, "/"); idx >= 0 {
		return entry.Category + "/" + rel[:idx]
	}
	return entry.Category
}

// scanRootDirectory 为每个普通文件返回一条记录。分类即
// 第一层目录，其下所有层级都属于 rel_path。
// onFile 在每发现一个文件时回调，参数为该文件所在目录（相对根目录）。
func scanRootDirectory(root model.ResourceRoot, onFile func(currentDir string)) ([]model.FileEntry, error) {
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
			if onFile != nil {
				currentDir := category
				if dir := filepath.ToSlash(filepath.Dir(rel)); dir != "." {
					currentDir = category + "/" + dir
				}
				onFile(currentDir)
			}
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
