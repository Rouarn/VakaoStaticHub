package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"vakao-static-hub/server/internal/media"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

// handleRandomPhoto 从随机图池中轮转返回一张图片的字节流。
// rootId / category 均可省略：省略 rootId 表示跨根目录，
// 省略 category 表示全部范围；每个范围内部按打乱后的队列
// 逐张发出，发完重新洗牌。无宽高时输出原图，带宽高时按
// webp（默认质量 80）生成缩略图。
func (s *Server) handleRandomPhoto(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	rootID := strings.TrimSpace(query.Get("rootId"))
	category := strings.TrimSpace(query.Get("category"))
	if category != "" {
		validated, err := validateCategoryName(category)
		if err != nil {
			return err
		}
		category = validated
	}

	options := media.ParseOptions(query, media.Defaults{
		Format:       media.FormatWebP,
		Quality:      80,
		Cover:        true,
		MaxDimension: s.cfg.MaxImageDimension,
	})

	var (
		root *model.ResourceRoot
		err  error
	)
	if rootID != "" {
		root, err = s.rootByID(r.Context(), rootID)
		if err != nil {
			return err
		}
	}

	entry, err := s.photos.Next(r.Context(), s.store, rootID, category)
	if errors.Is(err, store.ErrNotFound) {
		return notFound(randomImageMissingMessage(rootID, category))
	}
	if err != nil {
		return internalError(err)
	}
	if root == nil || root.ID != entry.RootID {
		root, err = s.rootByID(r.Context(), entry.RootID)
		if err != nil {
			return err
		}
	}

	full, err := storage.Join(filepath.Join(root.Path, entry.Category), entry.RelPath)
	if err != nil {
		return internalError(err)
	}
	info, err := os.Stat(full)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("磁盘上的图片文件已丢失")
	}
	if err != nil || info.IsDir() {
		return notFound("磁盘上的图片文件已丢失")
	}
	w.Header().Set("X-Photo-Id", strconv.FormatInt(entry.ID, 10))

	// 只有宽高同时存在时才缩放；缺任一项或明确要求
	// 原图时直接输出原始字节。
	if options.Format == media.FormatOriginal || options.Width == 0 || options.Height == 0 {
		return serveRandomFile(w, r, full, info)
	}

	result, err := s.thumbnails.Get(r.Context(), media.Request{
		SourcePath: full,
		CacheKey:   entry.RootID + "/" + entry.Category + "/" + entry.RelPath,
		Width:      options.Width,
		Height:     options.Height,
		Quality:    options.Quality,
		Format:     options.Format,
		Cover:      options.Cover,
	})
	switch {
	case err == nil:
		return serveRandomThumbnail(w, r, result)
	case errors.Is(err, media.ErrTooLarge):
		return &APIError{Status: http.StatusUnprocessableEntity, Code: "image_too_large", Message: "图片超出缩略图尺寸限制"}
	case errors.Is(err, media.ErrUnsupported):
		return serveRandomFile(w, r, full, info)
	default:
		return internalError(err)
	}
}

func randomImageMissingMessage(rootID, category string) string {
	conditions := make([]string, 0, 2)
	if rootID != "" {
		conditions = append(conditions, "root: "+rootID)
	}
	if category != "" {
		conditions = append(conditions, "category: "+category)
	}
	if len(conditions) == 0 {
		return "no image found"
	}
	return "no image found for the given condition (" + strings.Join(conditions, ", ") + ")"
}

// setNoStore 让浏览器与中间代理每次都重新请求随机图片。
func setNoStore(header http.Header) {
	header.Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
	header.Set("Pragma", "no-cache")
	header.Set("Expires", "0")
}

func serveRandomFile(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo) error {
	f, err := os.Open(path)
	if err != nil {
		return notFound("磁盘上的图片文件已丢失")
	}
	defer f.Close()
	header := w.Header()
	setNoStore(header)
	header.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

func serveRandomThumbnail(w http.ResponseWriter, r *http.Request, result media.Result) error {
	f, err := os.Open(result.Path)
	if err != nil {
		return internalError(err)
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return internalError(err)
	}
	header := w.Header()
	header.Set("Content-Type", result.ContentType)
	setNoStore(header)
	header.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}
