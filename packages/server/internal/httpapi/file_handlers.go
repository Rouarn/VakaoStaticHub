package httpapi

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"vakao-static-hub/server/internal/indexer"
	"vakao-static-hub/server/internal/media"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

const maxBatchPaths = 500

func (s *Server) handleFileConfig(w http.ResponseWriter, _ *http.Request, _ *CurrentUser) error {
	writeJSON(w, model.FileConfig{
		MaxUploadCount:    s.cfg.MaxUploadCount,
		ChunkSizeLimit:    s.cfg.ChunkSizeLimit,
		DefaultCategory:   s.cfg.DefaultCategory,
		MaxImagePixels:    s.cfg.MaxImagePixels,
		MaxImageDimension: s.cfg.MaxImageDimension,
		CacheRefreshMS:    s.cfg.CacheRefresh.Milliseconds(),
	})
	return nil
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	rootID := strings.TrimSpace(query.Get("rootId"))
	if rootID == "" {
		return badRequest("rootId 不能为空")
	}
	if _, err := s.rootByID(r.Context(), rootID); err != nil {
		return err
	}
	category := strings.TrimSpace(query.Get("category"))
	page, pageSize := pagination(r)

	items, total, err := s.store.ListFiles(r.Context(), store.FileFilter{
		RootID:   rootID,
		Category: category,
		Query:    strings.TrimSpace(query.Get("q")),
		Sort:     strings.ToLower(query.Get("sort")),
		Order:    strings.ToLower(query.Get("order")),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		return internalError(err)
	}
	for i := range items {
		items[i].URL = fileContentURL(items[i].ID)
	}
	writeJSON(w, model.Page[model.FileEntry]{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
	return nil
}

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

func (s *Server) handleFileStats(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	stats, err := s.store.StorageStats(r.Context())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, stats)
	return nil
}

func (s *Server) handleDuplicates(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	rootID := strings.TrimSpace(r.URL.Query().Get("rootId"))
	if rootID != "" {
		if _, err := s.rootByID(r.Context(), rootID); err != nil {
			return err
		}
	}
	page, pageSize := pagination(r)
	groups, total, err := s.store.DuplicateGroups(r.Context(), rootID, page, pageSize)
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, model.Page[model.DuplicateGroup]{
		Items:    groups,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
	return nil
}

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	var req struct {
		RootID string `json:"rootId"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}

	var roots []model.ResourceRoot
	if req.RootID != "" {
		root, err := s.store.RootByID(r.Context(), req.RootID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return notFound("资源根目录不存在")
			}
			return internalError(err)
		}
		roots = []model.ResourceRoot{*root}
	} else {
		var err error
		roots, err = s.store.ListRoots(r.Context())
		if err != nil {
			return internalError(err)
		}
	}

	ids := make([]string, 0, len(roots))
	for _, root := range roots {
		ids = append(ids, root.ID)
	}
	// 先取入队前的状态作为基线，再入队：调用方据此判断「本次扫描」是否已结束，
	// 避免秒级完成的根目录看起来像没执行。
	baseline := s.indexQueue.Snapshot(ids)
	queued := s.indexQueue.EnqueueAll(ids)
	// 语义改为「入队」：立即返回，实际扫描由单 worker 串行执行
	writeJSON(w, struct {
		Queued []string             `json:"queued"`
		Status []indexer.RootStatus `json:"status"`
	}{Queued: queued, Status: baseline})
	return nil
}

func (s *Server) handleBatchDelete(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.BatchDeleteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, category, err := s.resolveRequestLocation(r.Context(), req.RootID, req.Category)
	if err != nil {
		return err
	}
	paths, err := normalizeBatchPaths(req.Paths)
	if err != nil {
		return err
	}

	deleted := 0
	for _, rel := range paths {
		full, err := storage.Join(filepath.Join(root.Path, category), rel)
		if err != nil {
			return badRequest("路径无效：" + rel)
		}
		info, err := os.Lstat(full)
		if err != nil || info.IsDir() {
			continue
		}
		if err := os.Remove(full); err != nil {
			return badRequest("无法删除：" + rel)
		}
		if err := s.store.DeleteFileEntry(r.Context(), root.ID, category, rel); err != nil {
			s.log.Error("delete index entry failed", "error", err, "path", rel)
		}
		deleted++
	}
	s.audit(r, user, "file.batch_delete", "file", root.ID+"/"+category, map[string]any{"count": deleted})
	writeJSON(w, map[string]int{"deleted": deleted})
	return nil
}

func (s *Server) handleBatchMove(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.BatchMoveRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, category, err := s.resolveRequestLocation(r.Context(), req.RootID, req.Category)
	if err != nil {
		return err
	}
	target, err := validateCategoryName(req.TargetCategory)
	if err != nil {
		return err
	}
	if target == category {
		return badRequest("源分类与目标分类相同")
	}
	paths, err := normalizeBatchPaths(req.Paths)
	if err != nil {
		return err
	}

	sourceDir := filepath.Join(root.Path, category)
	targetDir := filepath.Join(root.Path, target)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return badRequest("无法创建目标分类")
	}
	// 先完成校验，避免批量操作中途停止。
	for _, rel := range paths {
		src, err := storage.Join(sourceDir, rel)
		if err != nil {
			return badRequest("路径无效：" + rel)
		}
		if info, err := os.Lstat(src); err != nil || info.IsDir() {
			return notFound("文件不存在：" + rel)
		}
		dst, err := storage.Join(targetDir, rel)
		if err != nil {
			return badRequest("路径无效：" + rel)
		}
		if _, err := os.Stat(dst); err == nil {
			return conflict("目标位置已存在同名文件：" + rel)
		}
	}

	moved := 0
	for _, rel := range paths {
		src := filepath.Join(sourceDir, filepath.FromSlash(rel))
		dst := filepath.Join(targetDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return badRequest("无法创建目标目录")
		}
		if err := os.Rename(src, dst); err != nil {
			return badRequest("无法移动：" + rel)
		}
		if err := s.store.MoveFileEntry(r.Context(), root.ID, category, rel, target, rel); err != nil {
			s.log.Error("move index entry failed", "error", err, "path", rel)
		}
		moved++
	}
	s.audit(r, user, "file.batch_move", "file", root.ID+"/"+category,
		map[string]any{"count": moved, "targetCategory": target})
	writeJSON(w, map[string]int{"moved": moved})
	return nil
}

func (s *Server) handleRenameFile(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.RenameFileRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, category, err := s.resolveRequestLocation(r.Context(), req.RootID, req.Category)
	if err != nil {
		return err
	}
	rel, err := storage.CleanRel(req.Path)
	if err != nil || rel == "" {
		return badRequest("路径无效")
	}
	newName, err := validateFileName(req.NewName)
	if err != nil {
		return err
	}

	categoryDir := filepath.Join(root.Path, category)
	src, err := storage.Join(categoryDir, rel)
	if err != nil {
		return badRequest("路径无效")
	}
	info, err := os.Lstat(src)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("文件不存在")
	}
	if err != nil || info.IsDir() {
		return badRequest("无法读取文件")
	}
	targetRel := filepath.ToSlash(filepath.Join(filepath.Dir(filepath.FromSlash(rel)), newName))
	if targetRel == rel {
		entry, err := s.store.FileByPath(r.Context(), root.ID, category, rel)
		if err != nil {
			return internalError(err)
		}
		entry.URL = fileContentURL(entry.ID)
		writeJSON(w, entry)
		return nil
	}
	dst, err := storage.Join(categoryDir, targetRel)
	if err != nil {
		return badRequest("文件名无效")
	}
	if _, err := os.Stat(dst); err == nil {
		return conflict("同名文件已存在")
	}
	if err := os.Rename(src, dst); err != nil {
		return badRequest("无法重命名文件")
	}
	if err := s.store.MoveFileEntry(r.Context(), root.ID, category, rel, category, targetRel); err != nil {
		s.log.Error("rename index entry failed", "error", err, "path", rel)
	}
	entry, err := s.store.FileByPath(r.Context(), root.ID, category, targetRel)
	if err != nil {
		return internalError(err)
	}
	entry.URL = fileContentURL(entry.ID)
	s.audit(r, user, "file.rename", "file", root.ID+"/"+category+"/"+targetRel,
		map[string]any{"from": rel})
	writeJSON(w, entry)
	return nil
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	query := r.URL.Query()
	root, category, err := s.resolveRequestLocation(r.Context(), query.Get("rootId"), query.Get("category"))
	if err != nil {
		return err
	}
	rel, err := storage.CleanRel(query.Get("path"))
	if err != nil || rel == "" {
		return badRequest("路径无效")
	}
	full, err := storage.Join(filepath.Join(root.Path, category), rel)
	if err != nil {
		return badRequest("路径无效")
	}
	info, err := os.Lstat(full)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("文件不存在")
	}
	if err != nil || info.IsDir() {
		return badRequest("无法读取文件")
	}
	if err := os.Remove(full); err != nil {
		return badRequest("无法删除文件")
	}
	if err := s.store.DeleteFileEntry(r.Context(), root.ID, category, rel); err != nil {
		s.log.Error("delete index entry failed", "error", err, "path", rel)
	}
	s.audit(r, user, "file.delete", "file", root.ID+"/"+category+"/"+rel, nil)
	writeJSON(w, nil)
	return nil
}

func (s *Server) handleFileContent(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	id, err := parseInt64(pathValue(r, "fileId"), "文件 id")
	if err != nil {
		return err
	}
	if id <= 0 {
		return badRequest("文件 id 无效")
	}
	entry, err := s.store.FileByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("文件不存在")
		}
		return internalError(err)
	}
	root, err := s.rootByID(r.Context(), entry.RootID)
	if err != nil {
		return err
	}
	category, err := validateCategoryName(entry.Category)
	if err != nil {
		return err
	}
	rel, err := storage.CleanRel(entry.RelPath)
	if err != nil || rel == "" {
		return notFound("文件不存在")
	}
	full, err := storage.Join(filepath.Join(root.Path, category), rel)
	if err != nil {
		return badRequest("路径无效")
	}
	info, err := os.Stat(full)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("文件不存在")
	}
	if err != nil {
		return badRequest("无法读取文件")
	}
	if info.IsDir() {
		return notFound("文件不存在")
	}
	return s.serveStoredFile(w, r, full, info, entry.RootID+"/"+category+"/"+rel)
}

// serveStoredFile 输出生成的缩略图或文件原始内容。
// 管理端文件路由与公开分享路由共用该函数。
func (s *Server) serveStoredFile(w http.ResponseWriter, r *http.Request, full string, info os.FileInfo, cacheKey string) error {
	query := r.URL.Query()
	download := query.Get("download") == "1" || strings.EqualFold(query.Get("download"), "true")
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(info.Name())), ".")
	width, _ := strconv.Atoi(query.Get("w"))
	height, _ := strconv.Atoi(query.Get("h"))
	format := strings.ToLower(strings.TrimSpace(query.Get("format")))
	quality, _ := strconv.Atoi(query.Get("q"))

	if !download && (width > 0 || height > 0) && format != "original" && media.Supports(extension) {
		if format != "webp" && format != "jpeg" && format != "jpg" && format != "" {
			return badRequest("format 只能为 jpeg 或 webp")
		}
		if format == "jpg" {
			format = "jpeg"
		}
		result, err := s.thumbnails.Get(r.Context(), media.Request{
			SourcePath: full,
			CacheKey:   cacheKey,
			Width:      width,
			Height:     height,
			Quality:    quality,
			Format:     format,
		})
		switch {
		case err == nil:
			serveThumbnail(w, r, result)
			return nil
		case errors.Is(err, media.ErrTooLarge):
			return &APIError{Status: http.StatusUnprocessableEntity, Code: "image_too_large", Message: "图片超出缩略图尺寸限制"}
		case errors.Is(err, media.ErrUnsupported):
			// 回退为输出原始内容。
		default:
			return internalError(err)
		}
	}

	return serveOriginal(w, r, full, info, download)
}

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

func fileContentURL(id int64) string {
	return "/v1/i/" + strconv.FormatInt(id, 10)
}

func serveOriginal(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo, download bool) error {
	f, err := os.Open(path)
	if err != nil {
		return notFound("文件不存在")
	}
	defer f.Close()

	header := w.Header()
	header.Set("ETag", `W/"`+strconv.FormatInt(info.Size(), 10)+`-`+strconv.FormatInt(info.ModTime().UnixMilli(), 10)+`"`)
	header.Set("Cache-Control", "public, max-age=3600")
	header.Set("Content-Disposition", contentDisposition(info.Name(), download))
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(info.Name())), ".")
	if extension == "html" || extension == "htm" || extension == "svg" {
		header.Set("Content-Security-Policy", "sandbox")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

func serveThumbnail(w http.ResponseWriter, r *http.Request, result media.Result) {
	f, err := os.Open(result.Path)
	if err != nil {
		writeError(w, internalError(err))
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeError(w, internalError(err))
		return
	}
	header := w.Header()
	header.Set("Content-Type", result.ContentType)
	header.Set("ETag", result.ETag)
	header.Set("Cache-Control", "public, max-age=86400")
	header.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func contentDisposition(name string, attachment bool) string {
	kind := "inline"
	if attachment {
		kind = "attachment"
	}
	ascii := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	return kind + `; filename="` + ascii + `"; filename*=UTF-8''` + encodeRFC5987(name)
}

func encodeRFC5987(value string) string {
	const digits = "0123456789ABCDEF"
	var b strings.Builder
	for _, c := range []byte(value) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			strings.ContainsRune("!#$&+-.^_`|~", rune(c)) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(digits[c>>4])
		b.WriteByte(digits[c&0x0f])
	}
	return b.String()
}
