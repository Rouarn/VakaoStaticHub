package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/upload"
)

const (
	minChunkSize     = 256 << 10
	maxChunkSize     = 64 << 20
	maxChunkCount    = 10000
	maxFileNameBytes = 255
)

// handleMultipartUpload 在一次流式处理中存储所有文件分片。全程
// 不在内存中缓冲：每个分片直接写入临时文件，同时计算 SHA-256。
func (s *Server) handleMultipartUpload(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	root, category, err := s.resolveRequestLocation(r.Context(),
		r.URL.Query().Get("rootId"), firstNonEmpty(r.URL.Query().Get("category"), s.cfg.DefaultCategory))
	if err != nil {
		return err
	}
	reader, err := r.MultipartReader()
	if err != nil {
		return unsupportedMedia("Content-Type 必须为 multipart/form-data")
	}
	dir := filepath.Join(root.Path, category)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return internalError(err)
	}

	result := model.UploadResult{Uploaded: make([]model.FileEntry, 0, 4), Failed: make([]model.UploadFailure, 0)}
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return badRequest("multipart 请求体格式错误")
		}
		if part.FormName() != "files" || part.FileName() == "" {
			_ = part.Close()
			continue
		}
		if len(result.Uploaded)+len(result.Failed) >= s.cfg.MaxUploadCount {
			_ = part.Close()
			return badRequest(fmt.Sprintf("单次最多上传 %d 个文件", s.cfg.MaxUploadCount))
		}
		entry, saveErr := s.storeUploadedPart(r.Context(), root, category, dir, part)
		_ = part.Close()
		if saveErr != nil {
			result.Failed = append(result.Failed, model.UploadFailure{Name: safeUploadName(part.FileName()), Error: saveErr.Error()})
			continue
		}
		result.Uploaded = append(result.Uploaded, entry)
	}

	writeJSON(w, result)
	if len(result.Uploaded) > 0 {
		s.audit(r, user, "file.upload", "file", category, map[string]any{
			"rootId": root.ID, "category": category, "count": len(result.Uploaded), "failed": len(result.Failed),
		})
	}
	return nil
}

func (s *Server) storeUploadedPart(ctx context.Context, root *model.ResourceRoot, category, dir string, part *multipart.Part) (model.FileEntry, error) {
	name := safeUploadName(part.FileName())
	if name == "" {
		return model.FileEntry{}, errors.New("文件名无效")
	}
	if _, err := validateFileName(name); err != nil {
		return model.FileEntry{}, errors.New("文件名无效")
	}

	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return model.FileEntry{}, errors.New("无法创建目标文件")
	}
	tmpName := tmp.Name()
	hasher := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(tmp, hasher), part)
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmpName)
		return model.FileEntry{}, errors.New("无法写入目标文件")
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		_ = os.Remove(tmpName)
		return model.FileEntry{}, errors.New("无法完成目标文件写入")
	}

	finalName := availableName(dir, name)
	if err := os.Rename(tmpName, filepath.Join(dir, finalName)); err != nil {
		_ = os.Remove(tmpName)
		return model.FileEntry{}, errors.New("无法完成目标文件写入")
	}
	info, err := os.Stat(filepath.Join(dir, finalName))
	if err != nil {
		return model.FileEntry{}, errors.New("无法读取已保存的文件")
	}

	entry, err := s.store.UpsertFile(ctx, model.FileEntry{
		RootID:      root.ID,
		Category:    category,
		RelPath:     finalName,
		Name:        finalName,
		Extension:   strings.TrimPrefix(strings.ToLower(filepath.Ext(finalName)), "."),
		Size:        size,
		MTime:       info.ModTime(),
		ContentHash: hex.EncodeToString(hasher.Sum(nil)),
	})
	if err != nil {
		return model.FileEntry{}, errors.New("文件已保存，但索引更新失败")
	}
	entry.URL = fileContentURL(entry.ID)
	return entry, nil
}

// handleInitChunk 创建分片上传会话。
func (s *Server) handleInitChunk(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	var req model.ChunkInitRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, category, err := s.resolveRequestLocation(r.Context(), req.RootID, firstNonEmpty(req.Category, s.cfg.DefaultCategory))
	if err != nil {
		return err
	}
	name := safeUploadName(req.Filename)
	if _, err := validateFileName(name); err != nil {
		return err
	}
	if req.Size <= 0 {
		return validationFailed("文件大小必须为正数").WithField("size", "文件大小必须为正数")
	}
	chunkSize := req.ChunkSize
	if chunkSize <= 0 {
		chunkSize = 5 << 20
	}
	if chunkSize < minChunkSize || chunkSize > maxChunkSize {
		return validationFailed("分片大小超出范围").WithField("chunkSize", "分片大小需在 256 KiB 到 64 MiB 之间")
	}
	if (req.Size+chunkSize-1)/chunkSize > maxChunkCount {
		return validationFailed("分片数量过多").WithField("chunkSize", "请增大分片大小")
	}

	session := upload.Session{
		ID:        newUploadID(),
		RootID:    root.ID,
		Category:  category,
		Filename:  name,
		Size:      req.Size,
		ChunkSize: chunkSize,
		CreatedAt: time.Now().UTC(),
	}
	if _, err := s.uploads.Create(session); err != nil {
		return internalError(err)
	}
	writeJSON(w, model.ChunkInitResponse{
		UploadID:       session.ID,
		ChunkSize:      session.ChunkSize,
		UploadedChunks: []int{},
	})
	return nil
}

// handleUploadChunk 将原始请求体写入一个分片。
func (s *Server) handleUploadChunk(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	session, _, err := s.uploads.Load(pathValue(r, "id"))
	if err != nil {
		return notFound("上传会话不存在")
	}
	index, err := parseInt64(pathValue(r, "index"), "分片序号")
	if err != nil {
		return err
	}
	if index < 0 || index >= int64(session.ChunkCount()) {
		return badRequest("分片序号超出范围")
	}
	if err := s.uploads.WriteChunk(session, int(index), http.MaxBytesReader(w, r.Body, session.ExpectedChunkSize(int(index))+1)); err != nil {
		if errors.Is(err, upload.ErrInvalidSession) {
			return notFound("上传会话不存在")
		}
		return validationFailed("分片大小与上传计划不一致")
	}
	writeJSON(w, nil)
	return nil
}

// handleCompleteChunk 合并所有分片并登记生成的文件。
func (s *Server) handleCompleteChunk(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.ChunkCompleteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	id := pathValue(r, "id")
	session, _, err := s.uploads.Load(id)
	if err != nil {
		return notFound("上传会话不存在")
	}
	if req.RootID != "" && req.RootID != session.RootID {
		return badRequest("rootId 与上传会话不一致")
	}
	if req.Category != "" && req.Category != session.Category {
		return badRequest("分类与上传会话不一致")
	}
	if req.Filename != "" && safeUploadName(req.Filename) != session.Filename {
		return badRequest("文件名与上传会话不一致")
	}
	if req.Size > 0 && req.Size != session.Size {
		return badRequest("文件大小与上传会话不一致")
	}

	root, err := s.rootByID(r.Context(), session.RootID)
	if err != nil {
		return err
	}
	dir := filepath.Join(root.Path, session.Category)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return internalError(err)
	}
	if _, err := os.Stat(filepath.Join(dir, session.Filename)); err == nil {
		return conflict("同名文件已存在")
	}

	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return internalError(err)
	}
	tmpName := tmp.Name()
	hasher := sha256.New()
	size, mergeErr := s.uploads.Merge(session, io.MultiWriter(tmp, hasher))
	if mergeErr != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		if errors.Is(mergeErr, upload.ErrIncomplete) {
			return conflict("上传尚未完成")
		}
		return internalError(mergeErr)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return internalError(err)
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		_ = os.Remove(tmpName)
		return internalError(err)
	}
	if err := os.Rename(tmpName, filepath.Join(dir, session.Filename)); err != nil {
		_ = os.Remove(tmpName)
		return internalError(err)
	}

	info, err := os.Stat(filepath.Join(dir, session.Filename))
	if err != nil {
		return internalError(err)
	}
	entry, err := s.store.UpsertFile(r.Context(), model.FileEntry{
		RootID:      root.ID,
		Category:    session.Category,
		RelPath:     session.Filename,
		Name:        session.Filename,
		Extension:   strings.TrimPrefix(strings.ToLower(filepath.Ext(session.Filename)), "."),
		Size:        size,
		MTime:       info.ModTime(),
		ContentHash: hex.EncodeToString(hasher.Sum(nil)),
	})
	if err != nil {
		return internalError(err)
	}
	_ = s.uploads.Remove(id)
	entry.URL = fileContentURL(entry.ID)
	writeJSON(w, entry)
	s.audit(r, user, "file.upload", "file", entry.RelPath, map[string]any{
		"rootId": root.ID, "category": session.Category, "size": size,
	})
	return nil
}

func (s *Server) handleCancelChunk(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	if err := s.uploads.Remove(pathValue(r, "id")); err != nil {
		return notFound("上传会话不存在")
	}
	writeJSON(w, nil)
	return nil
}

func newUploadID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}

func safeUploadName(raw string) string {
	name := strings.ReplaceAll(raw, "\\", "/")
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || len(name) > maxFileNameBytes {
		return ""
	}
	return name
}

// availableName 在目标名称已被占用时追加数字后缀。
func availableName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); errors.Is(err, os.ErrNotExist) {
		return name
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; i < 10000; i++ {
		candidate := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, err := os.Stat(filepath.Join(dir, candidate)); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return fmt.Sprintf("%s-%d%s", base, time.Now().UnixNano(), ext)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
