package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// handleHitokoto 代理配置的一言服务。响应会
// 原样转发，客户端可选择 JSON 或纯文本。
func (s *Server) handleHitokoto(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	if strings.TrimSpace(s.cfg.HitokotoURL) == "" {
		return &APIError{Status: http.StatusServiceUnavailable, Code: "hitokoto_proxy_disabled", Message: "一言代理未配置"}
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
		return &APIError{Status: http.StatusBadGateway, Code: "upstream_unavailable", Message: "一言上游服务不可达", Err: err}
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return &APIError{Status: http.StatusBadGateway, Code: "upstream_unavailable", Message: "无法读取上游响应", Err: err}
	}
	if resp.StatusCode >= 400 {
		return &APIError{Status: http.StatusBadGateway, Code: "upstream_error", Message: "一言上游返回错误"}
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json; charset=utf-8"
	}
	s.hitokotoCache.store(target, hitokotoEntry{contentType: contentType, body: body})
	writeProxyBody(w, contentType, body)
	return nil
}

// writeRaw 原样输出上游字节，并禁止浏览器嗅探类型。
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

// hitokotoEntry 是上游响应缓存项，expires 由 store 写入。
type hitokotoEntry struct {
	contentType string
	body        []byte
	expires     time.Time
}

// hitokotoCache 是按完整上游地址分键的进程内短缓存。
type hitokotoCache struct {
	mu      sync.Mutex
	entries map[string]hitokotoEntry
}

// load 读取未过期的缓存项；过期项按未命中处理，不主动删除。
func (c *hitokotoCache) load(key string) (hitokotoEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok || time.Now().After(entry.expires) {
		return hitokotoEntry{}, false
	}
	return entry, true
}

// store 写入缓存并固定 1 分钟有效期，用于压住上游的瞬时限流。
// 键数超过 128 时整体清空，避免按任意查询参数无限增长。
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
