package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"vakao-static-hub/server/internal/model"
)

const defaultJSONLimit = 1 << 20 // 1 MiB 足以覆盖所有 JSON 端点

// writeJSON 以统一信封（code=200, message=ok）写出成功响应。
func writeJSON(w http.ResponseWriter, payload any) {
	writeEnvelope(w, http.StatusOK, "ok", payload)
}

// writeEnvelope 是所有 JSON 响应的唯一出口：设置 Content-Type、
// 禁止类型嗅探，并关闭 HTML 转义（前端按纯文本渲染）。
func writeEnvelope(w http.ResponseWriter, status int, message string, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(model.Envelope{Code: status, Message: message, Data: data})
}

// writeError 把任意错误转成 APIError 后写出；非 APIError 一律按 500
// 处理，避免内部细节泄露。
func writeError(w http.ResponseWriter, err error) {
	apiErr := asAPIError(err)
	writeEnvelope(w, apiErr.Status, apiErr.Message, nil)
}

// decodeJSON 将 JSON 请求体解码到 dst。未知字段会被忽略，
// 以兼容旧客户端；格式错误或超限的请求体映射为 400/413。
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	if r.Body == nil {
		return badRequest("请求体不能为空")
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
		return unsupportedMedia("Content-Type 必须为 application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, defaultJSONLimit)
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return payloadTooLarge("请求体过大")
		}
		if errors.Is(err, io.EOF) {
			return badRequest("请求体不能为空")
		}
		return badRequest("JSON 请求体格式错误")
	}
	if dec.More() {
		return badRequest("请求体必须是单个 JSON 对象")
	}
	return nil
}
