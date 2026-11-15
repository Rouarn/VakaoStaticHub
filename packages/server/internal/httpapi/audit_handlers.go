package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

// handleAuditLogs 返回一页审计日志；过滤条件全部来自查询参数，
// 时间窗为 RFC 3339 闭区间，分页参数与文件列表口径一致。
func (s *Server) handleAuditLogs(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	filter := store.AuditFilter{
		Action:       strings.TrimSpace(query.Get("action")),
		Username:     strings.TrimSpace(query.Get("username")),
		ResourceType: strings.TrimSpace(query.Get("resourceType")),
		Query:        strings.TrimSpace(query.Get("q")),
	}
	if raw := strings.TrimSpace(query.Get("userId")); raw != "" {
		id, err := parseInt64(raw, "userId")
		if err != nil {
			return err
		}
		filter.UserID = &id
	}
	if raw := strings.TrimSpace(query.Get("startTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("startTime 需为 RFC 3339 时间格式").WithField("startTime", "时间格式无效")
		}
		filter.StartMS = parsed.UnixMilli()
	}
	if raw := strings.TrimSpace(query.Get("endTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("endTime 需为 RFC 3339 时间格式").WithField("endTime", "时间格式无效")
		}
		filter.EndMS = parsed.UnixMilli()
	}
	page, pageSize := pagination(r)
	filter.Page, filter.PageSize = page, pageSize

	items, total, err := s.store.ListAudit(r.Context(), filter)
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, model.Page[model.AuditLog]{
		Items: items, Total: total, Page: page, PageSize: pageSize,
	})
	return nil
}

// audit 异步语义地写一条审计日志：使用独立 context 与 3 秒超时，
// 因此请求被客户端取消也不影响记录；写失败只告警，不改变业务结果。
func (s *Server) audit(r *http.Request, user *CurrentUser, action, resourceType, resourceID string, details map[string]any) {
	entry := model.AuditLog{
		Username:     "system",
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Details:      details,
		IP:           clientIP(r, s.cfg.TrustProxy),
		UserAgent:    r.UserAgent(),
	}
	if user != nil {
		id := user.ID
		entry.UserID = &id
		entry.Username = user.Username
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := s.store.InsertAudit(ctx, entry); err != nil {
		s.log.Warn("write audit log failed", "error", err, "action", action)
	}
}
