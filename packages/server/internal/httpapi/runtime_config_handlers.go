package httpapi

import (
	"net/http"

	"vakao-static-hub/server/internal/model"
)

// handleRuntimeConfig 返回前端启动时需要读取的公开配置。
// 一言地址由服务端 HITOKOTO_API_URL 注入，页面据此直连一言服务；
// 本服务不再代理转发一言请求，留空表示页面关闭该功能。
func (s *Server) handleRuntimeConfig(w http.ResponseWriter, _ *http.Request, _ *CurrentUser) error {
	writeJSON(w, model.RuntimeConfig{HitokotoURL: s.cfg.HitokotoURL})
	return nil
}
