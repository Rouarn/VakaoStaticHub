package httpapi

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// mountSPA 从 WebDir 提供构建后的前端资源。目录
// 缺失时服务仍可运行，仅暴露 API。
func (s *Server) mountSPA() {
	info, err := os.Stat(s.cfg.WebDir)
	if err != nil || !info.IsDir() {
		s.log.Warn("web directory not found, serving API only", "webDir", s.cfg.WebDir)
		return
	}
	root := http.Dir(s.cfg.WebDir)
	s.mux.Handle("GET /assets/{path...}", spaFileHandler(s.cfg.WebDir, root))
	s.mux.Handle("GET /", s.spaFallback(s.cfg.WebDir, root))
	s.log.Info("serving frontend", "webDir", s.cfg.WebDir)
}

// spaFileHandler 服务 /assets/ 下的构建产物；不存在时返回 JSON 404，
// 而不是目录页或纯文本。
func spaFileHandler(dir string, root http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if !fileExists(root, name) {
			writeError(w, notFound("文件不存在"))
			return
		}
		serveSPAFile(w, r, dir, name)
	})
}

func (s *Server) spaFallback(dir string, root http.FileSystem) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/v1/") {
			writeError(w, notFound("接口不存在"))
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name != "" && fileExists(root, name) {
			serveSPAFile(w, r, dir, name)
			return
		}
		// SPA 路由：无扩展名的路径（/files、/shares/detail 等）一律回退到
		// index.html，交给前端路由处理；带扩展名的缺失资源仍按 404 处理。
		if name != "" && path.Ext(name) != "" {
			writeError(w, notFound("文件不存在"))
			return
		}
		name = "index.html"
		if !fileExists(root, name) {
			writeError(w, notFound("前端尚未构建"))
			return
		}
		serveSPAFile(w, r, dir, name)
	})
}

// serveSPAFile 按文件类型设置缓存策略：带指纹的 assets 与 sourcemap
// 长期不可变，index.html 必须 no-store，其余静态资源 1 小时。
func serveSPAFile(w http.ResponseWriter, r *http.Request, dir, name string) {
	switch {
	case strings.HasPrefix(name, "assets/"), strings.HasSuffix(name, ".map"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasSuffix(name, "index.html"):
		w.Header().Set("Cache-Control", "no-store")
		// media-src 与 img-src 保持同档：预览页允许通过 ?file= 直接播放
		// 任意 https 媒体地址。未显式声明时 <video>/<audio> 会回退到
		// default-src 'self'，跨域视频会被拦成「无法解码」。
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; img-src 'self' data: blob: https:; "+
				"media-src 'self' https:; "+
				"style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "+
				"connect-src 'self' https:; font-src 'self' data: https:; frame-ancestors 'none'")
	default:
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
	http.ServeFile(w, r, filepath.Join(dir, filepath.FromSlash(name)))
}

// fileExists 判断静态资源是否存在且不是目录。
func fileExists(root http.FileSystem, name string) bool {
	f, err := root.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	return true
}
