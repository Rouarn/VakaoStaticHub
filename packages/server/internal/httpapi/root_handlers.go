package httpapi

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

const maxBrowseEntries = 500

var rootIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

func (s *Server) handleListRoots(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	roots, err := s.store.ListRoots(r.Context())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, roots)
	return nil
}

func (s *Server) handleCreateRoot(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.CreateRootRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	req.ID = strings.TrimSpace(req.ID)
	req.Name = strings.TrimSpace(req.Name)
	req.Path = strings.TrimSpace(req.Path)
	if !rootIDPattern.MatchString(req.ID) {
		return validationFailed("资源根目录 id 无效").
			WithField("id", "需为 1-64 个字符，仅限字母、数字、点、短横线或下划线")
	}
	if req.Name == "" {
		return validationFailed("名称无效").WithField("name", "名称不能为空")
	}
	if req.Path == "" {
		return validationFailed("路径无效").WithField("path", "path 不能为空")
	}

	absPath := storage.Resolve(s.cfg.BaseDir, req.Path)
	if _, err := s.store.RootByID(r.Context(), req.ID); err == nil {
		return conflict("根目录 id 已存在")
	} else if !errors.Is(err, store.ErrNotFound) {
		return internalError(err)
	}
	if _, err := s.store.RootByPath(r.Context(), absPath); err == nil {
		return conflict("该路径已被其他根目录使用")
	} else if !errors.Is(err, store.ErrNotFound) {
		return internalError(err)
	}
	if err := ensureDirectory(absPath); err != nil {
		return err
	}

	root := model.ResourceRoot{
		ID:          req.ID,
		Name:        req.Name,
		Path:        absPath,
		Description: strings.TrimSpace(req.Description),
	}
	if err := s.store.CreateRoot(r.Context(), root); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return conflict("根目录 id 已存在")
		}
		return internalError(err)
	}
	created, err := s.store.RootByID(r.Context(), req.ID)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "root.create", "root", req.ID, map[string]any{"path": created.Path})
	// 新根目录立即排队扫描，不阻塞创建请求
	s.indexQueue.Enqueue(created.ID)
	writeJSON(w, created)
	return nil
}

// handleRootIndexStatus 一次返回全部根目录的索引状态。
func (s *Server) handleRootIndexStatus(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	roots, err := s.store.ListRoots(r.Context())
	if err != nil {
		return internalError(err)
	}
	ids := make([]string, 0, len(roots))
	for _, root := range roots {
		ids = append(ids, root.ID)
	}
	writeJSON(w, s.indexQueue.Snapshot(ids))
	return nil
}

func (s *Server) handleUpdateRoot(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	id := pathValue(r, "id")
	var req model.UpdateRootRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	current, err := s.store.RootByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("资源根目录不存在")
		}
		return internalError(err)
	}

	update := store.RootUpdate{}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return validationFailed("名称无效").WithField("name", "名称不能为空")
		}
		update.Name = &name
	}
	if req.Description != nil {
		description := strings.TrimSpace(*req.Description)
		update.Description = &description
	}
	if req.Path != nil {
		absPath := storage.Resolve(s.cfg.BaseDir, strings.TrimSpace(*req.Path))
		if strings.TrimSpace(*req.Path) == "" {
			return validationFailed("路径无效").WithField("path", "path 不能为空")
		}
		if absPath != current.Path {
			if other, err := s.store.RootByPath(r.Context(), absPath); err == nil && other.ID != id {
				return conflict("该路径已被其他根目录使用")
			} else if err != nil && !errors.Is(err, store.ErrNotFound) {
				return internalError(err)
			}
			entries, err := os.ReadDir(current.Path)
			if err == nil {
				for _, entry := range entries {
					if !strings.HasPrefix(entry.Name(), ".") {
						return conflict("该根目录下已有文件或分类，请新建根目录")
					}
				}
			} else if !errors.Is(err, fs.ErrNotExist) {
				return badRequest("无法读取当前根目录")
			}
			if err := ensureDirectory(absPath); err != nil {
				return err
			}
		}
		update.Path = &absPath
	}

	updated, err := s.store.UpdateRoot(r.Context(), id, update)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("资源根目录不存在")
		}
		if errors.Is(err, store.ErrConflict) {
			return conflict("该路径已被其他根目录使用")
		}
		return internalError(err)
	}
	s.audit(r, user, "root.update", "root", id, nil)
	writeJSON(w, updated)
	return nil
}

func (s *Server) handleDeleteRoot(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	id := pathValue(r, "id")
	root, err := s.store.RootByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("资源根目录不存在")
		}
		return internalError(err)
	}
	roots, err := s.store.ListRoots(r.Context())
	if err != nil {
		return internalError(err)
	}
	if len(roots) <= 1 {
		return conflict("至少需要保留一个根目录")
	}
	count, err := countFiles(root.Path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return badRequest("无法读取根目录")
	}
	if count > 0 {
		return conflict("根目录中仍有文件，请先清空")
	}
	if err := s.store.DeleteRoot(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("资源根目录不存在")
		}
		return internalError(err)
	}
	s.audit(r, user, "root.delete", "root", id, map[string]any{"name": root.Name})
	writeJSON(w, nil)
	return nil
}

func (s *Server) handleBrowse(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	raw := strings.TrimSpace(r.URL.Query().Get("path"))
	if raw != "" {
		for _, segment := range strings.FieldsFunc(raw, func(r rune) bool { return r == '/' || r == '\\' }) {
			if segment == ".." {
				return badRequest("路径不能包含 '..'")
			}
		}
	}

	bounds, _, err := s.browseBounds(r.Context())
	if err != nil {
		return err
	}
	target := ""
	if raw == "" {
		if home, err := os.UserHomeDir(); err == nil {
			target = home
		}
	} else {
		target = storage.Resolve(s.cfg.BaseDir, raw)
	}
	if target == "" {
		return badRequest("没有可用的起始目录")
	}

	real, err := filepath.EvalSymlinks(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return notFound("目录不存在")
		}
		return badRequest("无法解析目录")
	}

	boundary := ""
	for _, bound := range bounds {
		if storage.IsWithin(real, bound.Path) && len(bound.Path) > len(boundary) {
			boundary = bound.Path
		}
	}
	if boundary == "" {
		return forbidden("不允许浏览授权范围之外的目录")
	}

	info, err := os.Stat(real)
	if err != nil {
		return badRequest("无法读取目录")
	}
	if !info.IsDir() {
		return badRequest("目标不是目录")
	}
	entries, err := os.ReadDir(real)
	if err != nil {
		return badRequest("无法读取目录")
	}

	dirs := make([]model.BrowseEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirs = append(dirs, model.BrowseEntry{
			Name: entry.Name(),
			Path: filepath.Join(real, entry.Name()),
		})
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].Name < dirs[j].Name })

	total := len(dirs)
	truncated := total > maxBrowseEntries
	if truncated {
		dirs = dirs[:maxBrowseEntries]
	}

	parent := ""
	if real != boundary {
		parent = filepath.Dir(real)
	}
	writeJSON(w, model.BrowseResult{
		Path:      real,
		Parent:    parent,
		Entries:   dirs,
		Truncated: truncated,
		Total:     total,
	})
	return nil
}

func (s *Server) handleBrowseBounds(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	bounds, roots, err := s.browseBounds(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, model.BrowseBounds{Bounds: bounds, Roots: roots})
	return nil
}

// browseBounds 返回浏览器允许浏览的目录，以及指向已配置
// 根目录的快捷入口。已存在根目录的父级、进程主目录与
// 可选白名单是仅有的允许前缀。
func (s *Server) browseBounds(ctx context.Context) ([]model.BrowseBound, []model.BrowseRoot, error) {
	type candidate struct {
		path   string
		label  string
		source string
		rank   int
	}
	candidates := make([]candidate, 0, 8)
	add := func(path, label, source string, rank int) {
		if strings.TrimSpace(path) == "" {
			return
		}
		candidates = append(candidates, candidate{path: path, label: label, source: source, rank: rank})
	}

	if home, err := os.UserHomeDir(); err == nil {
		add(home, "用户主目录", "home", 2)
	}
	roots, err := s.store.ListRoots(ctx)
	if err != nil {
		return nil, nil, internalError(err)
	}
	shortcuts := make([]model.BrowseRoot, 0, len(roots))
	for _, root := range roots {
		add(filepath.Dir(root.Path), "根目录父级", "root-parent", 0)
		if real, err := filepath.EvalSymlinks(root.Path); err == nil {
			shortcuts = append(shortcuts, model.BrowseRoot{Path: real, Label: root.Name, RootID: root.ID})
		}
	}
	for _, item := range s.cfg.BrowseWhitelist {
		if filepath.IsAbs(item) {
			add(item, "白名单", "whitelist", 1)
		}
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].rank != candidates[j].rank {
			return candidates[i].rank < candidates[j].rank
		}
		return candidates[i].path < candidates[j].path
	})

	bounds := make([]model.BrowseBound, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, item := range candidates {
		real, err := filepath.EvalSymlinks(item.path)
		if err != nil {
			continue
		}
		if _, ok := seen[real]; ok {
			continue
		}
		seen[real] = struct{}{}
		bounds = append(bounds, model.BrowseBound{Path: real, Label: item.label, Source: item.source})
	}
	// 快捷入口沿用 ListRoots 的顺序（默认根在前，其余按创建时间升序）
	return bounds, shortcuts, nil
}

func ensureDirectory(path string) error {
	info, err := os.Stat(path)
	if err == nil {
		if !info.IsDir() {
			return badRequest("路径已存在且不是目录")
		}
		return nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return badRequest("无法访问该路径，请检查权限")
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return badRequest("没有创建目录的权限")
		}
		return badRequest("无法创建目录")
	}
	return nil
}

func countFiles(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		if entry.IsDir() {
			nested, err := countFiles(filepath.Join(dir, entry.Name()))
			if err != nil {
				return count, err
			}
			count += nested
			continue
		}
		if entry.Type().IsRegular() {
			count++
		}
	}
	return count, nil
}
