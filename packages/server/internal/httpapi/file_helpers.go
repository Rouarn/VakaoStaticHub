package httpapi

import (
	"context"
	"errors"
	"os"
	"strings"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

const maxBatchPaths = 500

func (s *Server) resolveRequestLocation(ctx context.Context, rootID, category string) (*model.ResourceRoot, string, error) {
	root, err := s.rootByID(ctx, strings.TrimSpace(rootID))
	if err != nil {
		return nil, "", err
	}
	name, err := validateCategoryName(category)
	if err != nil {
		return nil, "", err
	}
	return root, name, nil
}

func (s *Server) rootByID(ctx context.Context, id string) (*model.ResourceRoot, error) {
	if strings.TrimSpace(id) == "" {
		return nil, badRequest("rootId 不能为空")
	}
	root, err := s.store.RootByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, notFound("资源根目录不存在")
	}
	if err != nil {
		return nil, internalError(err)
	}
	return root, nil
}

func validateCategoryName(name string) (string, error) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return "", validationFailed("分类不能为空").WithField("category", "分类不能为空")
	case name == "." || name == "..":
		return "", validationFailed("分类名称无效").WithField("category", "名称无效")
	case strings.HasPrefix(name, "."):
		return "", validationFailed("分类名称无效").WithField("category", "名称不能以点开头")
	case strings.ContainsAny(name, `/\`):
		return "", validationFailed("分类名称无效").WithField("category", "名称不能包含斜杠")
	case len(name) > 128:
		return "", validationFailed("分类名称无效").WithField("category", "名称过长")
	}
	return name, nil
}

func validateFileName(name string) (string, error) {
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		return "", validationFailed("文件名不能为空").WithField("newName", "文件名不能为空")
	case name == "." || name == "..":
		return "", validationFailed("文件名无效").WithField("newName", "名称无效")
	case strings.ContainsAny(name, `/\`):
		return "", validationFailed("文件名无效").WithField("newName", "名称不能包含斜杠")
	case len(name) > 255:
		return "", validationFailed("文件名无效").WithField("newName", "名称过长")
	}
	return name, nil
}

func normalizeBatchPaths(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, badRequest("paths 不能为空")
	}
	if len(paths) > maxBatchPaths {
		return nil, badRequest("单次请求的文件数量过多")
	}
	cleaned := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, raw := range paths {
		rel, err := storage.CleanRel(raw)
		if err != nil || rel == "" {
			return nil, badRequest("路径无效：" + raw)
		}
		if _, ok := seen[rel]; ok {
			continue
		}
		seen[rel] = struct{}{}
		cleaned = append(cleaned, rel)
	}
	return cleaned, nil
}

func isEmptyDir(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			return false
		}
	}
	return true
}

func fileContentURL(code string) string {
	return "/v1/i/" + code
}
