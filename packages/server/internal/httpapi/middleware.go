package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
	"time"
)

// contextKey 是私有类型，避免与其他包的 context 键冲突。
type contextKey int

const (
	ctxKeyRequestID contextKey = iota
	ctxKeyUser
)

// middleware 是标准的 Handler 装饰器签名。
type middleware func(http.Handler) http.Handler

// chain 按声明顺序从外到内包装：第一个 middleware 最先收到请求。
func chain(h http.Handler, mws ...middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// requestIDFrom 读取当前请求的追踪 id；不存在时返回空串。
func requestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}

// withRequestID 复用调用方传入的 X-Request-Id（长度 1-64），否则生成
// 8 字节随机 id；该值同时写入响应头与 context，供日志串联。
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

// statusWriter 记录首个状态码与写出字节数，供访问日志使用。
// 多次 WriteHeader 只记第一次，与 net/http 的实际行为一致。
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
			body = `{"code":404,"message":"接口不存在","data":null}` + "\n"
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

// loggingMiddleware 输出结构化访问日志，5xx 记 error、4xx 记 warn，
// 并附带 requestId 与解析后的客户端 IP。
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

// recoverMiddleware 兜住处理函数里的 panic：记录堆栈后返回不泄露
// 细节的 500，保证单个请求异常不会带崩进程。
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

// securityHeadersMiddleware 统一加上基础安全响应头；
// 文件预览另由响应处按扩展名追加 sandbox CSP。
func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

// corsMiddleware 按配置放行跨域来源：来源列表为空或包含 "*" 时放行全部，
// 否则只放行精确匹配的来源。
//
// 跨域请求需要携带 Authorization 与凭据，因此固定回
// Access-Control-Allow-Credentials: true；带凭据时规范禁止把
// Access-Control-Allow-Origin 设为 "*"，只能回显请求的 Origin，并用
// Vary: Origin 让缓存按来源区分。OPTIONS 预检直接返回 204，未放行的
// 来源拿不到 CORS 头，由浏览器自行拦截。
func corsMiddleware(origins []string) middleware {
	allowAll := len(origins) == 0
	for _, origin := range origins {
		if origin == "*" {
			allowAll = true
			break
		}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			h := w.Header()
			h.Add("Vary", "Origin")
			if origin != "" && (allowAll || slices.Contains(origins, origin)) {
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions {
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

// bucket 是限流器里单个键的固定窗口计数。
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

// newRateLimiter 构造固定窗口限流器；limit 为窗口内允许次数。
func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, items: make(map[string]*bucket)}
}

// allow 判断键是否仍有配额。条目超过 8192 时先清理过期项，
// 因此内存占用与活跃客户端数成正比，而不是与请求总数成正比。
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
