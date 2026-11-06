package httpapi

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"vakao-static-hub/server/internal/auth"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/sharelink"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

const maxSharePaths = 500

func (s *Server) handleListShares(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	page, pageSize := pagination(r)
	records, total, err := s.store.ListShares(r.Context(), store.ShareFilter{
		Query:    strings.TrimSpace(r.URL.Query().Get("q")),
		Status:   strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status"))),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		return internalError(err)
	}
	items := make([]model.ShareLink, 0, len(records))
	for _, record := range records {
		items = append(items, record.ShareLink)
	}
	counts, err := s.store.ShareStatusCounts(r.Context(), store.NowMS())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, model.ShareListResponse{
		Items: items, Total: total, Page: page, PageSize: pageSize, Counts: counts,
	})
	return nil
}

func (s *Server) handleCreateShare(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.CreateShareRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	root, category, err := s.resolveRequestLocation(r.Context(), req.RootID, req.Category)
	if err != nil {
		return err
	}
	paths, err := normalizeBatchPaths(req.FilePaths)
	if err != nil {
		return err
	}
	if len(paths) > maxSharePaths {
		return badRequest("单个分享的文件数量过多")
	}
	// 任一文件缺失时立即失败，避免创建
	// 残缺的分享链接。
	categoryDir := filepath.Join(root.Path, category)
	for _, rel := range paths {
		full, err := storage.Join(categoryDir, rel)
		if err != nil {
			return badRequest("路径无效：" + rel)
		}
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			return notFound("文件不存在：" + rel)
		}
	}

	record := store.ShareRecord{
		ShareLink: model.ShareLink{
			Token:       newShareToken(),
			RootID:      root.ID,
			Category:    category,
			FilePaths:   paths,
			Remark:      strings.TrimSpace(req.Remark),
			Enabled:     req.Enabled == nil || *req.Enabled,
			MaxAccesses: normalizedMaxAccesses(req.MaxAccesses),
		},
	}
	if req.ExpiresAt != nil {
		expiresAt, err := parseShareExpiry(*req.ExpiresAt)
		if err != nil {
			return err
		}
		record.ExpiresAt = expiresAt
	}
	if password := strings.TrimSpace(req.Password); password != "" {
		if len(password) < 4 || len(password) > 128 {
			return validationFailed("密码长度需在 4 到 128 个字符之间").WithField("password", "长度不合法")
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			return internalError(err)
		}
		record.PasswordHash = hash
	}

	created, err := s.store.CreateShare(r.Context(), record)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "share.create", "share", created.Token, map[string]any{
		"rootId": created.RootID, "category": created.Category, "files": len(created.FilePaths),
	})
	writeJSON(w, created.ShareLink)
	return nil
}

func (s *Server) handleUpdateShare(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	token := pathValue(r, "token")
	var req model.UpdateShareRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	update := store.ShareUpdate{
		Remark:      req.Remark,
		Enabled:     req.Enabled,
		MaxAccesses: normalizedMaxAccesses(req.MaxAccesses),
	}
	if req.ExpiresAt != nil {
		expiresAt, err := parseShareExpiry(*req.ExpiresAt)
		if err != nil {
			return err
		}
		value := int64(0)
		if expiresAt != nil {
			value = expiresAt.UnixMilli()
		}
		update.ExpiresAt = &value
	}
	if req.Password != nil {
		password := strings.TrimSpace(*req.Password)
		hash := ""
		if password != "" {
			if len(password) < 4 || len(password) > 128 {
				return validationFailed("密码长度需在 4 到 128 个字符之间").WithField("password", "长度不合法")
			}
			generated, err := auth.HashPassword(password)
			if err != nil {
				return internalError(err)
			}
			hash = generated
		}
		update.PasswordHash = &hash
	}
	if err := s.store.UpdateShare(r.Context(), token, update); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("分享不存在")
		}
		return internalError(err)
	}
	updated, err := s.store.ShareByToken(r.Context(), token)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "share.update", "share", token, nil)
	writeJSON(w, updated.ShareLink)
	return nil
}

func (s *Server) handleDeleteShare(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	token := pathValue(r, "token")
	if err := s.store.DeleteShare(r.Context(), token); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("分享不存在")
		}
		return internalError(err)
	}
	s.audit(r, user, "share.revoke", "share", token, nil)
	writeJSON(w, nil)
	return nil
}

func (s *Server) handleShareAccessLogs(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	record, err := s.store.ShareByToken(r.Context(), pathValue(r, "token"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("分享不存在")
		}
		return internalError(err)
	}
	page, pageSize := pagination(r)
	logs, total, err := s.store.ListShareAccessLogs(r.Context(), record.ID, page, pageSize)
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, model.Page[model.ShareAccessLog]{
		Items: logs, Total: total, Page: page, PageSize: pageSize,
	})
	return nil
}

// handlePublicShareInfo 返回访问页所需的分享元数据。不可用的
// 链接返回 410，便于客户端展示统一提示。
func (s *Server) handlePublicShareInfo(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	record, err := s.availableShare(r, pathValue(r, "token"), true)
	if err != nil {
		return err
	}
	writeJSON(w, shareInfo(record))
	return nil
}

func (s *Server) handleUnlockShare(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	if !s.shareLimiter.allow(clientIP(r, s.cfg.TrustProxy)) {
		return tooManyRequests("解锁尝试过于频繁，请稍后再试")
	}
	var req model.ShareVerifyRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	record, err := s.availableShare(r, pathValue(r, "token"), false)
	if err != nil {
		return err
	}
	ip := clientIP(r, s.cfg.TrustProxy)
	agent := r.UserAgent()
	if record.PasswordHash != "" && !auth.VerifyPassword(req.Password, record.PasswordHash) {
		_ = s.store.InsertShareAccessLog(r.Context(), record.ID, ip, agent, false)
		return unauthorized("访问密码错误")
	}
	token, expiresAt, err := s.shareTokens.Issue(record.ID, record.Token)
	if err != nil {
		return internalError(err)
	}
	if err := s.store.IncrementShareAccess(r.Context(), record.ID); err != nil {
		s.log.Error("increment share access failed", "error", err, "token", record.Token)
	}
	_ = s.store.InsertShareAccessLog(r.Context(), record.ID, ip, agent, true)
	writeJSON(w, model.ShareVerifyResponse{Token: token, ExpiresAt: expiresAt.UTC()})
	return nil
}

func (s *Server) handleShareFiles(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	record, err := s.availableShare(r, pathValue(r, "token"), true)
	if err != nil {
		return err
	}
	if _, err := s.authorizeShareAccess(r, record); err != nil {
		return err
	}
	root, err := s.rootByID(r.Context(), record.RootID)
	if err != nil {
		return err
	}
	categoryDir := filepath.Join(root.Path, record.Category)
	files := make([]model.ShareFile, 0, len(record.FilePaths))
	for index, rel := range record.FilePaths {
		name := filepath.Base(rel)
		item := model.ShareFile{
			Index:     index,
			Name:      name,
			Path:      rel,
			Extension: strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), "."),
			URL:       "/v1/s/" + record.Token + "/f/" + strconv.Itoa(index),
			Exists:    false,
		}
		if full, err := storage.Join(categoryDir, rel); err == nil {
			if info, statErr := os.Stat(full); statErr == nil && !info.IsDir() {
				item.Size = info.Size()
				item.Exists = true
			}
		}
		files = append(files, item)
	}
	writeJSON(w, model.ShareContent{Share: shareInfo(record), Files: files})
	return nil
}

// shareInfo 去除密码哈希，并将记录映射为公开结构。
func shareInfo(record store.ShareRecord) model.ShareInfo {
	return model.ShareInfo{
		Token:       record.Token,
		Remark:      record.Remark,
		RootID:      record.RootID,
		Category:    record.Category,
		FilePaths:   record.FilePaths,
		HasPassword: record.PasswordHash != "",
		ExpiresAt:   record.ExpiresAt,
		MaxAccesses: record.MaxAccesses,
		AccessCount: record.AccessCount,
		Enabled:     record.Enabled,
	}
}

func (s *Server) handleShareFileContent(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	record, err := s.availableShare(r, pathValue(r, "token"), true)
	if err != nil {
		return err
	}
	if _, err := s.authorizeShareAccess(r, record); err != nil {
		return err
	}
	index, err := parseInt64(pathValue(r, "index"), "文件序号")
	if err != nil {
		return err
	}
	if index < 0 || index >= int64(len(record.FilePaths)) {
		return notFound("文件不存在")
	}
	root, err := s.rootByID(r.Context(), record.RootID)
	if err != nil {
		return err
	}
	rel, err := storage.CleanRel(record.FilePaths[index])
	if err != nil || rel == "" {
		return badRequest("路径无效")
	}
	full, err := storage.Join(filepath.Join(root.Path, record.Category), rel)
	if err != nil {
		return badRequest("路径无效")
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return notFound("文件不存在")
	}
	return s.serveStoredFile(w, r, full, info, "share:"+record.Token+"/"+rel)
}

// availableShare 加载分享并拒绝已无法打开的链接。
func (s *Server) availableShare(r *http.Request, token string, allowExhaustedToken bool) (store.ShareRecord, error) {
	record, err := s.store.ShareByToken(r.Context(), token)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return store.ShareRecord{}, &APIError{Status: http.StatusNotFound, Code: "share_not_found", Message: "分享链接不存在"}
		}
		return store.ShareRecord{}, internalError(err)
	}
	switch record.Status {
	case "active":
		return record, nil
	case "disabled":
		return store.ShareRecord{}, &APIError{Status: http.StatusGone, Code: "share_disabled", Message: "分享链接已停用"}
	case "expired":
		return store.ShareRecord{}, &APIError{Status: http.StatusGone, Code: "share_expired", Message: "分享链接已过期"}
	case "exhausted":
		// 最后一次允许的解锁会递增计数，因此需放行已持有 Token 的
		// 客户端，使其在本次会话内继续读取。
		if allowExhaustedToken {
			if claims, err := s.shareTokens.Parse(strings.TrimSpace(r.URL.Query().Get("accessToken"))); err == nil &&
				claims.ShareID == record.ID && claims.Token == record.Token {
				return record, nil
			}
		}
		return store.ShareRecord{}, &APIError{Status: http.StatusGone, Code: "share_exhausted", Message: "分享链接打开次数已达上限"}
	default:
		return store.ShareRecord{}, gone("分享链接已失效")
	}
}

// authorizeShareAccess 校验可选的访问 Token。密码保护的
// 分享必须有 Token；公开分享接受匿名请求。
func (s *Server) authorizeShareAccess(r *http.Request, record store.ShareRecord) (sharelink.Claims, error) {
	value := strings.TrimSpace(r.URL.Query().Get("accessToken"))
	if value == "" {
		if record.PasswordHash == "" {
			return sharelink.Claims{ShareID: record.ID, Token: record.Token}, nil
		}
		return sharelink.Claims{}, unauthorized("该分享需要访问密码")
	}
	claims, err := s.shareTokens.Parse(value)
	if err != nil {
		return sharelink.Claims{}, unauthorized("分享访问令牌无效或已过期")
	}
	if claims.ShareID != record.ID || claims.Token != record.Token {
		return sharelink.Claims{}, unauthorized("分享访问令牌与当前链接不匹配")
	}
	return claims, nil
}

func parseShareExpiry(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, validationFailed("expiresAt 需为 RFC 3339 时间格式").WithField("expiresAt", "时间格式无效")
	}
	if !parsed.After(time.Now()) {
		return nil, validationFailed("expiresAt 必须晚于当前时间").WithField("expiresAt", "必须晚于当前时间")
	}
	return &parsed, nil
}

func normalizedMaxAccesses(value *int) *int {
	if value == nil {
		return nil
	}
	if *value <= 0 {
		zero := 0
		return &zero
	}
	return value
}

func newShareToken() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}
