package office

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// tempFileMinAge 是残留临时目录/文件的最短保留时间，
// 避免误删正在转换的任务。
const tempFileMinAge = time.Hour

// CleanupOptions 控制一次缓存清理；Retention 或 MaxBytes 为 0
// 时跳过对应规则。
type CleanupOptions struct {
	Retention time.Duration
	MaxBytes  int64
	Now       time.Time
}

// CleanupStats 汇总一次清理的结果。
type CleanupStats struct {
	Expired        int
	Temp           int
	OverCap        int
	FreedBytes     int64
	RemainingBytes int64
}

type cacheFile struct {
	path string
	size int64
	mod  time.Time
}

// Cleanup 清理 office 缓存：残留临时任务、超过保留期的 PDF，
// 超容量时按最久未修改淘汰。用户配置目录（profiles）不参与清理。
func (c *Converter) Cleanup(opts CleanupOptions) (CleanupStats, error) {
	var stats CleanupStats
	now := opts.Now
	if now.IsZero() {
		now = time.Now()
	}
	info, err := os.Stat(c.root)
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
	err = filepath.WalkDir(c.root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			if d.Name() == "profiles" {
				return filepath.SkipDir
			}
			dirs = append(dirs, path)
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		item, err := d.Info()
		if err != nil {
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
		// tmp/job-* 是正在使用或中断的任务目录，按目录整体清理留给下面的空目录处理。
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
	})
	if err != nil {
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

	// 删除空的分片目录与任务目录，保留缓存根、tmp 与 profiles。
	for i := len(dirs) - 1; i >= 0; i-- {
		if dirs[i] == c.root || dirs[i] == filepath.Join(c.root, "tmp") {
			continue
		}
		_ = os.Remove(dirs[i])
	}
	return stats, nil
}
