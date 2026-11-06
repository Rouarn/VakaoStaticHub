package httpapi

import (
	"net/http"
	"strconv"
	"strings"
)

const (
	defaultPageSize = 20
	maxPageSize     = 200
)

// pagination 规范化 page/pageSize 查询参数。
func pagination(r *http.Request) (page, pageSize int) {
	page = 1
	pageSize = defaultPageSize
	if raw := r.URL.Query().Get("page"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			page = n
		}
	}
	if raw := r.URL.Query().Get("pageSize"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			pageSize = n
		}
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

func pathValue(r *http.Request, name string) string {
	return r.PathValue(name)
}

func parseInt64(value, field string) (int64, error) {
	n, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0, badRequest("invalid " + field)
	}
	return n, nil
}

func requireQuery(r *http.Request, name string) (string, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return "", badRequest(name + " is required")
	}
	return value, nil
}
