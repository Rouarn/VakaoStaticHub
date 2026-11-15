package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

// handleListCategories 合并磁盘目录与索引统计：磁盘上新建但尚未扫描
// 的分类也会返回（计数为 0），保证列表与文件系统一致。
func (s *Server) handleListCategories(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	rootID, err := requireQuery(r, "rootId")
	if err != nil {
		return err
	}
	root, err := s.rootByID(r.Context(), rootID)
	if err != nil {
		return err
	}
	stats, err := s.store.CategoryStats(r.Context(), rootID)
	if err != nil {
		return internalError(err)
	}
	byName := make(map[string]model.CategoryInfo, len(stats))
	for _, item := range stats {
		byName[item.Name] = item
	}

	items := make([]model.CategoryInfo, 0, len(stats)+4)
	seen := make(map[string]struct{}, len(stats))
	entries, err := os.ReadDir(root.Path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return badRequest("无法读取根目录")
	}
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		// software-update 是独立的资源根，默认根下不重复展示为分类
		if rootID == store.DefaultRootID && entry.Name() == store.PackageCategoryName {
			continue
		}
		name := entry.Name()
		seen[name] = struct{}{}
		if stat, ok := byName[name]; ok {
			items = append(items, stat)
			continue
		}
		items = append(items, model.CategoryInfo{Name: name})
	}
	for _, stat := range stats {
		if _, ok := seen[stat.Name]; !ok {
			items = append(items, stat)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	writeJSON(w, items)
	return nil
}

// handleCreateCategory 在根目录下创建分类目录；同名分类已存在时返回冲突。
func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.CreateCategoryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, err := s.rootByID(r.Context(), strings.TrimSpace(req.RootID))
	if err != nil {
		return err
	}
	name, err := validateCategoryName(req.Name)
	if err != nil {
		return err
	}
	path := filepath.Join(root.Path, name)
	if _, err := os.Stat(path); err == nil {
		return conflict("分类已存在")
	} else if !errors.Is(err, fs.ErrNotExist) {
		return badRequest("无法访问分类路径")
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return badRequest("无法创建分类")
	}
	s.audit(r, user, "category.create", "category", root.ID+"/"+name, nil)
	writeJSON(w, map[string]string{"name": name})
	return nil
}

// handleRenameCategory 重命名分类目录并同步重算索引短码。
// 索引更新失败只记日志：目录已改名，下次扫描会自行修正。
func (s *Server) handleRenameCategory(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.RenameCategoryRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, err := s.rootByID(r.Context(), strings.TrimSpace(req.RootID))
	if err != nil {
		return err
	}
	name, err := validateCategoryName(req.Name)
	if err != nil {
		return err
	}
	newName, err := validateCategoryName(req.NewName)
	if err != nil {
		return err
	}
	if name == newName {
		writeJSON(w, map[string]string{"name": name})
		return nil
	}
	oldPath := filepath.Join(root.Path, name)
	info, err := os.Stat(oldPath)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("分类不存在")
	}
	if err != nil || !info.IsDir() {
		return badRequest("无法读取分类")
	}
	newPath := filepath.Join(root.Path, newName)
	if _, err := os.Stat(newPath); err == nil {
		return conflict("目标分类已存在")
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return badRequest("无法重命名分类")
	}
	if err := s.store.RenameCategory(r.Context(), root.ID, name, newName); err != nil {
		// 目录已移动但索引尚未更新，下一次扫描会修正。
		s.log.Error("rename category index update failed", "error", err, "root", root.ID, "category", name)
	}
	s.audit(r, user, "category.rename", "category", root.ID+"/"+newName, map[string]any{"from": name})
	writeJSON(w, map[string]string{"name": newName})
	return nil
}

// handleDeleteCategory 删除分类目录。非空分类必须显式传 recursive=1，
// 以免误删整目录文件。
func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	rootID, err := requireQuery(r, "rootId")
	if err != nil {
		return err
	}
	root, err := s.rootByID(r.Context(), rootID)
	if err != nil {
		return err
	}
	name, err := validateCategoryName(r.URL.Query().Get("name"))
	if err != nil {
		return err
	}
	path := filepath.Join(root.Path, name)
	info, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("分类不存在")
	}
	if err != nil || !info.IsDir() {
		return badRequest("无法读取分类")
	}
	recursive := r.URL.Query().Get("recursive") == "1" || strings.EqualFold(r.URL.Query().Get("recursive"), "true")
	if !recursive && !isEmptyDir(path) {
		return conflict("分类不为空，请传入 recursive=1 以连同文件一并删除")
	}
	if err := os.RemoveAll(path); err != nil {
		return badRequest("无法删除分类")
	}
	if err := s.store.DeleteCategoryEntries(r.Context(), root.ID, name); err != nil {
		s.log.Error("delete category index failed", "error", err, "root", root.ID, "category", name)
	}
	s.audit(r, user, "category.delete", "category", root.ID+"/"+name, map[string]any{"recursive": recursive})
	writeJSON(w, nil)
	return nil
}
