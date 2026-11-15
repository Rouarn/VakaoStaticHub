package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
)

// handleBatchDelete 逐条删除文件；单个文件失败会中止并返回 400，
// 已删除的部分不会回滚。不存在的路径会被跳过。
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

// handleBatchMove 先把所有目标冲突查完再执行移动，避免批量操作
// 中途留下半完成状态。保留文件在分类内的相对路径。
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

// handleRenameFile 重命名分类内文件（保持所在子目录），并同步索引。
// 新名与原名相同时只回查记录，不做磁盘操作。
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
		entry.URL = fileContentURL(entry.Code)
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
	entry.URL = fileContentURL(entry.Code)
	s.audit(r, user, "file.rename", "file", root.ID+"/"+category+"/"+targetRel,
		map[string]any{"from": rel})
	writeJSON(w, entry)
	return nil
}

// handleDeleteFile 删除单个文件并清理索引；不支持目录。
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
