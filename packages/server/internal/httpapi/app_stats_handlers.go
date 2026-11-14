package httpapi

import (
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleAppFunnel(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	appKey := pathValue(r, "appKey")
	query := r.URL.Query()
	end := time.Now()
	start := end.AddDate(0, 0, -30)
	if raw := strings.TrimSpace(query.Get("startTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("startTime 需为 RFC 3339 时间格式").WithField("startTime", "时间格式无效")
		}
		start = parsed
	}
	if raw := strings.TrimSpace(query.Get("endTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("endTime 需为 RFC 3339 时间格式").WithField("endTime", "时间格式无效")
		}
		end = parsed
	}
	result, err := s.store.Funnel(r.Context(), appKey, start.UnixMilli(), end.UnixMilli())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, result)
	return nil
}
