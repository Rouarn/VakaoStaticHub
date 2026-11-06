package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

type contextKey int

const (
	ctxKeyRequestID contextKey = iota
	ctxKeyUser
)

type middleware func(http.Handler) http.Handler

func chain(h http.Handler, mws ...middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

func requestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-Id")
		if len(id) == 0 || len(id) > 64 {
			buf := make([]byte, 8)
			_, _ = rand.Read(buf)
			id = hex.EncodeToString(buf)
		}
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKeyRequestID, id)))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(p)
	w.bytes += n
	return n, err
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// apiErrorShape 将 ServeMux 对未知路径返回的纯文本 404 改写为
// JSON，使所有 /v1/ 响应（包括未命中）都是 JSON。
type apiErrorShape struct {
	http.ResponseWriter
	path     string
	hijacked bool
}

func (w *apiErrorShape) WriteHeader(code int) {
	if (strings.HasPrefix(w.path, "/v1/") || w.path == "/healthz") && strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") {
		var body string
		switch code {
		case http.StatusNotFound:
			body = `{"code":404,"message":"endpoint not found","data":null}` + "\n"
		case http.StatusMethodNotAllowed:
			body = `{"code":405,"message":"method not allowed","data":null}` + "\n"
		}
		if body != "" {
			w.hijacked = true
			w.Header().Del("Content-Length")
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.ResponseWriter.WriteHeader(code)
			_, _ = w.ResponseWriter.Write([]byte(body))
			return
		}
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *apiErrorShape) Write(p []byte) (int, error) {
	if w.hijacked {
		return len(p), nil
	}
	return w.ResponseWriter.Write(p)
}

func (w *apiErrorShape) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *apiErrorShape) Unwrap() http.ResponseWriter { return w.ResponseWriter }

type loggingMiddleware struct {
	log        *slog.Logger
	trustProxy bool
}

func (m loggingMiddleware) handle(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		status := sw.status
		if status == 0 {
			status = http.StatusOK
		}
		level := slog.LevelInfo
		switch {
		case status >= 500:
			level = slog.LevelError
		case status >= 400:
			level = slog.LevelWarn
		}
		m.log.Log(r.Context(), level, "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"bytes", sw.bytes,
			"durationMs", time.Since(start).Milliseconds(),
			"ip", clientIP(r, m.trustProxy),
			"requestId", requestIDFrom(r.Context()),
		)
	})
}

func recoverMiddleware(log *slog.Logger) middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic recovered",
						"panic", rec,
						"path", r.URL.Path,
						"requestId", requestIDFrom(r.Context()),
						"stack", string(debug.Stack()),
					)
					writeError(w, internalError(nil))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(origin string) middleware {
	return func(next http.Handler) http.Handler {
		if origin == "" {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Origin") == origin {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Vary", "Origin")
				h.Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions {
				h := w.Header()
				h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id")
				h.Set("Access-Control-Max-Age", "600")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// clientIP 解析调用方地址，仅在进程配置为位于可信反向
// 代理之后时才会采用 X-Forwarded-For。
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			first, _, _ := strings.Cut(forwarded, ",")
			if ip := strings.TrimSpace(first); ip != "" {
				return ip
			}
		}
		if real := strings.TrimSpace(r.Header.Get("X-Real-Ip")); real != "" {
			return real
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type bucket struct {
	start time.Time
	count int
}

// rateLimiter 是以客户端身份为键的固定窗口计数器。它足够
// 轻量，用于保护少数需要防护的未认证端点。
type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	items  map[string]*bucket
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, items: make(map[string]*bucket)}
}

func (l *rateLimiter) allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.items) > 8192 {
		for k, b := range l.items {
			if now.Sub(b.start) > l.window {
				delete(l.items, k)
			}
		}
	}
	b, ok := l.items[key]
	if !ok || now.Sub(b.start) >= l.window {
		l.items[key] = &bucket{start: now, count: 1}
		return true
	}
	if b.count >= l.limit {
		return false
	}
	b.count++
	return true
}
