package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"vakao-static-hub/server/internal/office"
)

// serveConvertedDocument 输出 Office 文档转换后的 PDF。
// 转换结果按「源路径 + 大小 + 修改时间」落盘缓存，同一文件只转一次；
// 前端拼地址时会把同一份「大小 + 修改时间」作为版本参数带上，文件一变
// 地址就变，因此这里的响应可以按内容不可变长期缓存。
func (s *Server) serveConvertedDocument(w http.ResponseWriter, r *http.Request, full string, info os.FileInfo) error {
	if s.documents == nil {
		return &APIError{Status: http.StatusServiceUnavailable, Code: "office_unavailable", Message: "文档转换服务不可用"}
	}
	result, err := s.documents.Convert(r.Context(), full, info)
	switch {
	case err == nil:
	case errors.Is(err, office.ErrUnsupported):
		return &APIError{Status: http.StatusUnprocessableEntity, Code: "office_unsupported", Message: "该格式不支持服务端转换预览"}
	case errors.Is(err, office.ErrTooLarge):
		return &APIError{
			Status:  http.StatusUnprocessableEntity,
			Code:    "office_too_large",
			Message: fmt.Sprintf("文件超过 %d MB，已跳过在线转换", s.cfg.OfficeMaxInput>>20),
		}
	case errors.Is(err, office.ErrBusy):
		return &APIError{Status: http.StatusServiceUnavailable, Code: "office_busy", Message: "转换任务排队中，请稍后再试"}
	case errors.Is(err, context.Canceled):
		// 客户端已断开，无需响应。
		return nil
	default:
		s.log.Error("office convert failed", "error", err, "path", full)
		return internalError(err)
	}

	f, err := os.Open(result.Path)
	if err != nil {
		return internalError(err)
	}
	defer f.Close()
	pdfInfo, err := f.Stat()
	if err != nil {
		return internalError(err)
	}

	header := w.Header()
	header.Set("Content-Type", "application/pdf")
	header.Set("ETag", result.ETag)
	// 地址里带文件版本，内容变化即换地址：按内容不可变长期缓存，
	// 不再需要靠缩短 max-age 兜陈旧，也不会每次回源触发重新下载。
	header.Set("Cache-Control", "public, max-age=31536000, immutable")
	header.Set("Content-Disposition", contentDisposition(strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))+".pdf", false))
	http.ServeContent(w, r, pdfInfo.Name(), pdfInfo.ModTime(), f)
	return nil
}
