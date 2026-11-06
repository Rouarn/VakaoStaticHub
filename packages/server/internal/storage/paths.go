package storage

import (
	"errors"
	"path/filepath"
	"strings"
)

var ErrInvalidPath = errors.New("invalid path")

// Resolve 将配置的根目录路径转换为绝对文件系统路径。
// 相对配置值以 baseDir 为基准解析。
func Resolve(baseDir, path string) string {
	path = strings.TrimSpace(path)
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(baseDir, path)
}

// CleanRel 规范化相对于资源根目录的路径，并拒绝任何可能
// 逃逸出根目录的路径段。
func CleanRel(rel string) (string, error) {
	rel = strings.ReplaceAll(rel, "\\", "/")
	rel = strings.Trim(rel, "/")
	if rel == "" {
		return "", nil
	}
	segments := strings.Split(rel, "/")
	cleaned := make([]string, 0, len(segments))
	for _, seg := range segments {
		switch seg {
		case "", ".":
			continue
		case "..":
			return "", ErrInvalidPath
		}
		cleaned = append(cleaned, seg)
	}
	if len(cleaned) == 0 {
		return "", nil
	}
	return strings.Join(cleaned, "/"), nil
}

// Join 在 root 内解析 rel，并保证结果仍位于 root 之下。
func Join(root, rel string) (string, error) {
	clean, err := CleanRel(rel)
	if err != nil {
		return "", err
	}
	full := filepath.Join(root, filepath.FromSlash(clean))
	if !IsWithin(full, root) {
		return "", ErrInvalidPath
	}
	return full, nil
}

// IsWithin 判断 child 是否等于 parent 或位于其下。
func IsWithin(child, parent string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
