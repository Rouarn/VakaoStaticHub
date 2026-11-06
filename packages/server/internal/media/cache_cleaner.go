package media

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// tempFileMinAge 是 .tmp-* 文件的最短保留时间，避免误删
// 正在写入的缩略图。
const tempFileMinAge = time.Hour

// CleanupOptions 控制一次缩略图缓存清理。Retention 或
// MaxBytes 为 0 时跳过对应规则。
type CleanupOptions struct {
	Retention time.Duration
	MaxBytes  int64
	Now       time.Time
}

// CleanupStats 汇总一次清理的结果。
type CleanupStats struct {
	Expired        int   // 超过保留期被删除的数量
	Temp           int   // 残留临时文件被删除的数量
	OverCap        int   // 超出容量上限被淘汰的数量
	FreedBytes     int64 // 释放的字节数
	RemainingBytes int64 // 清理后缓存占用
}

type cacheFile struct {
	path string
	size int64
	mod  time.Time
}

// Cleanup 扫描缩略图缓存目录，依次清理残留临时文件、
// 超过保留期的文件，并在超出容量上限时按最久未访问淘汰。
// 该操作幂等，可重复执行。
func (t *Thumbnailer) Cleanup(opts CleanupOptions) (CleanupStats, error) {
	var stats CleanupStats
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	root := filepath.Join(t.cacheDir, "thumbs")
	info, err := os.Stat(root)
	if errors.Is(err, fs.ErrNotExist) {
		return stats, nil
	}
	if err != nil {
		return stats, err
	}
	if !info.IsDir() {
		return stats, nil
	}

	files := make([]cacheFile, 0, 128)
	dirs := make([]string, 0, 16)
	var total int64
	if err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			dirs = append(dirs, path)
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		item, err := d.Info()
		if err != nil {
			// 文件可能刚被并发请求删除，忽略即可。
			return nil
		}
		if strings.HasPrefix(d.Name(), ".tmp-") {
			if now.Sub(item.ModTime()) >= tempFileMinAge {
				if err := os.Remove(path); err == nil {
					stats.Temp++
					stats.FreedBytes += item.Size()
				}
			}
			return nil
		}
		if opts.Retention > 0 && now.Sub(item.ModTime()) > opts.Retention {
			if err := os.Remove(path); err == nil {
				stats.Expired++
				stats.FreedBytes += item.Size()
			}
			return nil
		}
		files = append(files, cacheFile{path: path, size: item.Size(), mod: item.ModTime()})
		total += item.Size()
		return nil
	}); err != nil {
		return stats, err
	}

	if opts.MaxBytes > 0 && total > opts.MaxBytes {
		sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
		for _, file := range files {
			if total <= opts.MaxBytes {
				break
			}
			if err := os.Remove(file.path); err == nil {
				total -= file.size
				stats.OverCap++
				stats.FreedBytes += file.size
			}
		}
	}
	stats.RemainingBytes = total

	// 删除已空的分片目录，保留缓存根目录本身。
	for i := len(dirs) - 1; i >= 0; i-- {
		if dirs[i] == root {
			continue
		}
		_ = os.Remove(dirs[i])
	}
	return stats, nil
}
