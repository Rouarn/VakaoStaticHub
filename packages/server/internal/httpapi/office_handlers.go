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
// 转换结果按「源路径 + 大小 + 修改时间」落盘缓存，同一文件只转一次。
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
	// 转换结果 URL 稳定（源地址 + as=pdf），允许 CDN/浏览器短缓存：
	// 未缓存的响应会落到 CDN 的动态回源通道，大文件既慢又容易在并发
	// Range 请求下被中断。内容变化最多滞后 5 分钟。
	header.Set("Cache-Control", "public, max-age=300")
	header.Set("Content-Disposition", contentDisposition(strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))+".pdf", false))
	http.ServeContent(w, r, pdfInfo.Name(), pdfInfo.ModTime(), f)
	return nil
}
