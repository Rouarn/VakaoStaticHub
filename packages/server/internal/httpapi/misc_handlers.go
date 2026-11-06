package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"vakao-static-hub/server/internal/media"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
	"vakao-static-hub/server/internal/sysinfo"
)

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
			return validationFailed("startTime must be RFC 3339").WithField("startTime", "invalid timestamp")
		}
		filter.StartMS = parsed.UnixMilli()
	}
	if raw := strings.TrimSpace(query.Get("endTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("endTime must be RFC 3339").WithField("endTime", "invalid timestamp")
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

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	ctx := r.Context()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	files, totalSize, err := s.store.StorageTotals(ctx)
	if err != nil {
		return internalError(err)
	}
	users, _ := s.store.CountUsers(ctx)
	shares, _ := s.store.CountShares(ctx)
	versions, _ := s.store.CountVersions(ctx)
	events, _ := s.store.CountUpgradeEvents(ctx)
	audits, _ := s.store.CountAudit(ctx)
	roots, _ := s.store.RootMetrics(ctx)
	shareCounts, _ := s.store.ShareStatusCounts(ctx, store.NowMS())
	versionCounts, _ := s.store.VersionStatusMetrics(ctx)
	events24h, _ := s.store.UpgradeEventCounts(ctx, time.Now().Add(-24*time.Hour).UnixMilli())

	writeJSON(w, model.Metrics{
		Version:       s.version,
		UptimeSeconds: int64(time.Since(s.started).Seconds()),
		GoVersion:     runtime.Version(),
		Memory: model.MemoryMetrics{
			RSS:       sysinfo.RSS(),
			HeapAlloc: mem.HeapAlloc,
			HeapSys:   mem.HeapSys,
			Sys:       mem.Sys,
			NumGC:     mem.NumGC,
		},
		QPS: s.qps.value(),
		Database: model.DatabaseMetrics{
			Path:    s.cfg.DBPath,
			Size:    fileSize(s.cfg.DBPath),
			WALSize: fileSize(s.cfg.DBPath + "-wal"),
		},
		Storage: model.StorageMetrics{
			FileRoot:  s.cfg.FileRoot,
			FileCount: files,
			TotalSize: totalSize,
		},
		Counts: model.CountMetrics{
			Users:         users,
			Files:         files,
			Shares:        shares,
			AppVersions:   versions,
			UpgradeEvents: events,
			AuditLogs:     audits,
		},
		Roots:            roots,
		Shares:           model.ShareStatusMetric{Total: shareCounts.All, Active: shareCounts.Active, Expired: shareCounts.Expired},
		Apps:             versionCounts,
		UpgradeEvents24h: events24h,
	})
	return nil
}

func (s *Server) handleMetricsSidebar(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	ctx := r.Context()
	files, totalSize, err := s.store.StorageTotals(ctx)
	if err != nil {
		return internalError(err)
	}
	shares, _ := s.store.CountShares(ctx)
	users, _ := s.store.CountUsers(ctx)
	versions, _ := s.store.CountVersions(ctx)
	writeJSON(w, model.SidebarMetrics{
		Files: files, Shares: shares, Users: users, AppVersions: versions, TotalSize: totalSize,
	})
	return nil
}

// handleHitokoto 代理配置的一言服务。响应会
// 原样转发，客户端可选择 JSON 或纯文本。
func (s *Server) handleHitokoto(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	if strings.TrimSpace(s.cfg.HitokotoURL) == "" {
		return &APIError{Status: http.StatusServiceUnavailable, Code: "hitokoto_proxy_disabled", Message: "hitokoto proxy is not configured"}
	}
	target := s.cfg.HitokotoURL
	if raw := r.URL.RawQuery; raw != "" {
		separator := "?"
		if strings.Contains(target, "?") {
			separator = "&"
		}
		target += separator + raw
	}
	if cached, ok := s.hitokotoCache.load(target); ok {
		writeProxyBody(w, cached.contentType, cached.body)
		return nil
	}

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(target)
	if err != nil {
		return &APIError{Status: http.StatusBadGateway, Code: "upstream_unavailable", Message: "hitokoto upstream is unreachable", Err: err}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return &APIError{Status: http.StatusBadGateway, Code: "upstream_unavailable", Message: "cannot read the upstream response", Err: err}
	}
	if resp.StatusCode >= 400 {
		return &APIError{Status: http.StatusBadGateway, Code: "upstream_error", Message: "hitokoto upstream returned an error"}
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json; charset=utf-8"
	}
	s.hitokotoCache.store(target, hitokotoEntry{contentType: contentType, body: body})
	writeProxyBody(w, contentType, body)
	return nil
}

// handleRandomPhoto 从随机图池中返回一张图片的字节流。
// 与旧版语义一致：rootId / category 均可省略，省略 rootId
// 表示跨根目录，省略 category 表示全部范围；无宽高时输出
// 原图，带宽高时按 webp（默认质量 80）生成缩略图。
func (s *Server) handleRandomPhoto(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	rootID := strings.TrimSpace(query.Get("rootId"))
	category := strings.TrimSpace(query.Get("category"))
	if category != "" {
		validated, err := validateCategoryName(category)
		if err != nil {
			return err
		}
		category = validated
	}

	width, err := parsePositiveDimension(query.Get("w"), query.Get("width"))
	if err != nil {
		return err
	}
	height, err := parsePositiveDimension(query.Get("h"), query.Get("height"))
	if err != nil {
		return err
	}
	quality := 80
	if raw := strings.TrimSpace(query.Get("q")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return badRequest("q must be a number")
		}
		quality = parsed
	}
	format := "webp"
	if raw := strings.ToLower(strings.TrimSpace(query.Get("format"))); raw != "" {
		switch raw {
		case "webp":
			format = "webp"
		case "jpeg", "jpg":
			format = "jpeg"
		case "original":
			format = "original"
		default:
			return badRequest("format must be jpeg, webp or original")
		}
	}

	var root *model.ResourceRoot
	if rootID != "" {
		root, err = s.rootByID(r.Context(), rootID)
		if err != nil {
			return err
		}
	}

	entry, err := s.store.RandomImage(r.Context(), rootID, category)
	if errors.Is(err, store.ErrNotFound) {
		return notFound(randomImageMissingMessage(rootID, category))
	}
	if err != nil {
		return internalError(err)
	}
	if root == nil || root.ID != entry.RootID {
		root, err = s.rootByID(r.Context(), entry.RootID)
		if err != nil {
			return err
		}
	}

	full, err := storage.Join(filepath.Join(root.Path, entry.Category), entry.RelPath)
	if err != nil {
		return internalError(err)
	}
	info, err := os.Stat(full)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("image file is missing on disk")
	}
	if err != nil || info.IsDir() {
		return notFound("image file is missing on disk")
	}

	// 旧版只有宽高同时存在时才缩放；缺任一项或明确要求
	// 原图时直接输出原始字节。
	if format == "original" || width == 0 || height == 0 {
		return serveRandomFile(w, r, full, info)
	}

	result, err := s.thumbnails.Get(r.Context(), media.Request{
		SourcePath: full,
		CacheKey:   entry.RootID + "/" + entry.Category + "/" + entry.RelPath,
		Width:      width,
		Height:     height,
		Quality:    quality,
		Format:     format,
		Cover:      true,
	})
	switch {
	case err == nil:
		return serveRandomThumbnail(w, r, result)
	case errors.Is(err, media.ErrTooLarge):
		return &APIError{Status: http.StatusUnprocessableEntity, Code: "image_too_large", Message: "image exceeds the thumbnail limit"}
	case errors.Is(err, media.ErrUnsupported):
		return serveRandomFile(w, r, full, info)
	default:
		return internalError(err)
	}
}

func parsePositiveDimension(values ...string) (int, error) {
	for _, raw := range values {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return 0, badRequest("width and height must be positive numbers")
		}
		return value, nil
	}
	return 0, nil
}

func randomImageMissingMessage(rootID, category string) string {
	conditions := make([]string, 0, 2)
	if rootID != "" {
		conditions = append(conditions, "root: "+rootID)
	}
	if category != "" {
		conditions = append(conditions, "category: "+category)
	}
	if len(conditions) == 0 {
		return "no image found"
	}
	return "no image found for the given condition (" + strings.Join(conditions, ", ") + ")"
}

// setNoStore 让浏览器与中间代理每次都重新请求随机图片。
func setNoStore(header http.Header) {
	header.Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
	header.Set("Pragma", "no-cache")
	header.Set("Expires", "0")
}

func serveRandomFile(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo) error {
	f, err := os.Open(path)
	if err != nil {
		return notFound("image file is missing on disk")
	}
	defer f.Close()
	header := w.Header()
	setNoStore(header)
	header.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

func serveRandomThumbnail(w http.ResponseWriter, r *http.Request, result media.Result) error {
	f, err := os.Open(result.Path)
	if err != nil {
		return internalError(err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return internalError(err)
	}
	header := w.Header()
	header.Set("Content-Type", result.ContentType)
	setNoStore(header)
	header.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

// handlePlaceholder 生成确定性的 SVG 占位图。尺寸来自
// 路径（或查询参数），并会被限制在合理范围内。
func (s *Server) handlePlaceholder(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	width := firstInt(pathValue(r, "width"), query.Get("width"), query.Get("w"), "600")
	height := firstInt(pathValue(r, "height"), query.Get("height"), query.Get("h"), "400")
	if size := strings.TrimSpace(pathValue(r, "size")); size != "" {
		square := firstInt(size, "", "", "400")
		width, height = square, square
	}
	width = clamp(width, 1, 4096)
	height = clamp(height, 1, 4096)

	text := query.Get("text")
	if text == "" {
		text = fmt.Sprintf("%d × %d", width, height)
	}
	bg := sanitizeColor(firstNonEmpty(query.Get("bgColor"), query.Get("bg")), "#e5e7eb")
	fg := sanitizeColor(firstNonEmpty(query.Get("textColor"), query.Get("fg")), "#374151")
	fontFamily := sanitizeFontFamily(query.Get("fontFamily"))
	fontWeight := sanitizeFontWeight(query.Get("fontWeight"))
	fontSize := clamp(firstInt(query.Get("fontSize"), "", "", "0"), 0, 512)
	if fontSize == 0 {
		fontSize = clamp(width/10, 12, 120)
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`, width, height, width, height)
	fmt.Fprintf(&b, `<rect width="100%%" height="100%%" fill="%s"/>`, bg)
	fmt.Fprintf(&b, `<text x="50%%" y="50%%" fill="%s" font-family="%s" font-size="%d" font-weight="%s" text-anchor="middle" dominant-baseline="middle">%s</text>`,
		fg, fontFamily, fontSize, fontWeight, html.EscapeString(text))
	b.WriteString(`</svg>`)

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, b.String())
	return nil
}

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

func writeRaw(w http.ResponseWriter, contentType string, body []byte) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// writeProxyBody 代理上游响应：JSON 包进统一信封，纯文本原样输出。
func writeProxyBody(w http.ResponseWriter, contentType string, body []byte) {
	if strings.Contains(contentType, "json") {
		var payload any
		if json.Unmarshal(body, &payload) == nil {
			writeJSON(w, payload)
			return
		}
	}
	writeRaw(w, contentType, body)
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func firstInt(values ...string) int {
	for _, value := range values {
		if n, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && n > 0 {
			return n
		}
	}
	return 0
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func sanitizeColor(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if strings.HasPrefix(value, "#") && len(value) <= 9 {
		for _, c := range value[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
				return fallback
			}
		}
		return value
	}
	switch value {
	case "transparent", "black", "white", "red", "green", "blue", "gray", "grey":
		return value
	}
	return fallback
}

func sanitizeFontFamily(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "sans-serif"
	}
	for _, c := range value {
		if !(c == '-' || c == ' ' || c == ',' || c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			return "sans-serif"
		}
	}
	if len(value) > 64 {
		return "sans-serif"
	}
	return value
}

func sanitizeFontWeight(value string) string {
	switch strings.TrimSpace(value) {
	case "100", "200", "300", "400", "500", "600", "700", "800", "900", "normal", "bold", "bolder", "lighter":
		return strings.TrimSpace(value)
	}
	return "600"
}

// qpsMeter 维护最近一分钟内已处理请求的滑动计数。
type qpsMeter struct {
	mu      sync.Mutex
	buckets [60]int64
	second  int64
}

func (m *qpsMeter) hit() {
	now := time.Now().Unix()
	m.mu.Lock()
	defer m.mu.Unlock()
	if now != m.second {
		gap := now - m.second
		if gap >= int64(len(m.buckets)) {
			m.buckets = [60]int64{}
		} else {
			for i := int64(1); i <= gap; i++ {
				m.buckets[(m.second+i)%int64(len(m.buckets))] = 0
			}
		}
		m.second = now
	}
	m.buckets[now%int64(len(m.buckets))]++
}

func (m *qpsMeter) value() float64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var total int64
	for _, count := range m.buckets {
		total += count
	}
	return float64(total) / float64(len(m.buckets))
}

type hitokotoEntry struct {
	contentType string
	body        []byte
	expires     time.Time
}

type hitokotoCache struct {
	mu      sync.Mutex
	entries map[string]hitokotoEntry
}

func (c *hitokotoCache) load(key string) (hitokotoEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || time.Now().After(entry.expires) {
		return hitokotoEntry{}, false
	}
	return entry, true
}

func (c *hitokotoCache) store(key string, entry hitokotoEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.entries == nil {
		c.entries = make(map[string]hitokotoEntry)
	}
	if len(c.entries) > 128 {
		c.entries = make(map[string]hitokotoEntry)
	}
	entry.expires = time.Now().Add(time.Minute)
	c.entries[key] = entry
}
