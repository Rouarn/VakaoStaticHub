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

func writeJSON(w http.ResponseWriter, payload any) {
	writeEnvelope(w, http.StatusOK, "ok", payload)
}

func writeEnvelope(w http.ResponseWriter, status int, message string, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(model.Envelope{Code: status, Message: message, Data: data})
}

func writeError(w http.ResponseWriter, err error) {
	apiErr := asAPIError(err)
	writeEnvelope(w, apiErr.Status, apiErr.Message, nil)
}

// decodeJSON 将 JSON 请求体解码到 dst。未知字段会被忽略，
// 以兼容旧客户端；格式错误或超限的请求体映射为 400/413。
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	if r.Body == nil {
		return badRequest("request body is required")
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || (mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) {
		return unsupportedMedia("Content-Type must be application/json")
	}
	r.Body = http.MaxBytesReader(w, r.Body, defaultJSONLimit)
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return payloadTooLarge("request body is too large")
		}
		if errors.Is(err, io.EOF) {
			return badRequest("request body is required")
		}
		return badRequest("invalid JSON body")
	}
	if dec.More() {
		return badRequest("request body must contain a single JSON object")
	}
	return nil
}
