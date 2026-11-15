package httpapi

import (
	"errors"
	"fmt"
	"net/http"
)

// APIError 是处理函数唯一返回的错误类型。其他错误一律视为
// 内部故障，其细节不会暴露给客户端。
type APIError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	Err     error
}

// Error 实现 error 接口，仅用于日志；Message 之外的内部错误
// 不会随响应体返回。
func (e *APIError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

// Unwrap 暴露底层错误，使 errors.Is/As 能穿透到原始原因。
func (e *APIError) Unwrap() error { return e.Err }

// WithField 追加一个字段级错误信息并返回自身，便于链式构造。
// 注意它会修改 e，因此不要复用同一个 *APIError 实例。
func (e *APIError) WithField(name, message string) *APIError {
	if e.Fields == nil {
		e.Fields = make(map[string]string, 1)
	}
	e.Fields[name] = message
	return e
}

func badRequest(message string) *APIError {
	return &APIError{Status: http.StatusBadRequest, Code: "bad_request", Message: message}
}

func validationFailed(message string) *APIError {
	return &APIError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: message}
}

func unauthorized(message string) *APIError {
	return &APIError{Status: http.StatusUnauthorized, Code: "unauthorized", Message: message}
}

func forbidden(message string) *APIError {
	return &APIError{Status: http.StatusForbidden, Code: "forbidden", Message: message}
}

func notFound(message string) *APIError {
	return &APIError{Status: http.StatusNotFound, Code: "not_found", Message: message}
}

func conflict(message string) *APIError {
	return &APIError{Status: http.StatusConflict, Code: "conflict", Message: message}
}

func gone(message string) *APIError {
	return &APIError{Status: http.StatusGone, Code: "gone", Message: message}
}

func payloadTooLarge(message string) *APIError {
	return &APIError{Status: http.StatusRequestEntityTooLarge, Code: "payload_too_large", Message: message}
}

func unsupportedMedia(message string) *APIError {
	return &APIError{Status: http.StatusUnsupportedMediaType, Code: "unsupported_media_type", Message: message}
}

func tooManyRequests(message string) *APIError {
	return &APIError{Status: http.StatusTooManyRequests, Code: "rate_limited", Message: message}
}

func internalError(err error) *APIError {
	return &APIError{Status: http.StatusInternalServerError, Code: "internal_error", Message: "服务器内部错误", Err: err}
}

func unavailable(err error) *APIError {
	return &APIError{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: "服务暂时不可用", Err: err}
}

// asAPIError 把任意错误归一为 *APIError：已经是 APIError 的原样返回，
// 其余包装成 500 并保留原始错误供日志记录。
func asAPIError(err error) *APIError {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr
	}
	return internalError(err)
}
