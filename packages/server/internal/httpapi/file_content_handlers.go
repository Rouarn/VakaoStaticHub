package httpapi

import (
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"vakao-static-hub/server/internal/media"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

// shortCodePattern 限定内容短码的形态：sha256 前 12 位十六进制字符。
var shortCodePattern = regexp.MustCompile(`^[0-9a-f]{12}$`)

// cachePolicy 是响应缓存策略的封闭集合，避免调用方拼任意 Cache-Control。
type cachePolicy int

const (
	// cacheImmutable 用于「地址随内容变化」的产物：/v1/i 的原始文件、
	// 缩略图、带文件版本的转换 PDF。
	cacheImmutable cachePolicy = iota
	// cacheShare 用于分享内文件：地址稳定，撤销后还要靠过期兜底，故按 7 天。
	cacheShare
)

// header 返回对应策略的 Cache-Control 值。
func (p cachePolicy) header() string {
	if p == cacheShare {
		return "public, max-age=604800"
	}
	return "public, max-age=31536000, immutable"
}

// handleFileContent 按内容短码输出文件。短码由内容哈希派生，
// 因此同一地址的内容不会变化，可以长期缓存；路径每一段都重新校验，
// 索引里即使混入异常路径也不会越界。
func (s *Server) handleFileContent(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	code := strings.ToLower(strings.TrimSpace(pathValue(r, "code")))
	if !shortCodePattern.MatchString(code) {
		return notFound("文件不存在")
	}
	entry, err := s.store.FileByShortCode(r.Context(), code)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("文件不存在")
		}
		return internalError(err)
	}
	root, err := s.rootByID(r.Context(), entry.RootID)
	if err != nil {
		return err
	}
	category, err := validateCategoryName(entry.Category)
	if err != nil {
		return err
	}
	rel, err := storage.CleanRel(entry.RelPath)
	if err != nil || rel == "" {
		return notFound("文件不存在")
	}
	full, err := storage.Join(filepath.Join(root.Path, category), rel)
	if err != nil {
		return badRequest("路径无效")
	}
	info, err := os.Stat(full)
	if errors.Is(err, fs.ErrNotExist) {
		return notFound("文件不存在")
	}
	if err != nil {
		return badRequest("无法读取文件")
	}
	if info.IsDir() {
		return notFound("文件不存在")
	}
	return s.serveStoredFile(w, r, full, info, entry.RootID+"/"+category+"/"+rel, cacheImmutable)
}

// serveStoredFile 输出生成的缩略图或文件原始内容。
// 管理端文件路由与公开分享路由共用该函数，cache 决定响应的缓存策略。
func (s *Server) serveStoredFile(w http.ResponseWriter, r *http.Request, full string, info os.FileInfo, cacheKey string, cache cachePolicy) error {
	query := r.URL.Query()
	download := query.Get("download") == "1" || strings.EqualFold(query.Get("download"), "true")
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(info.Name())), ".")
	options := media.ParseOptions(query, media.Defaults{
		Format:       media.FormatJPEG,
		Quality:      media.DefaultQuality,
		MaxDimension: s.cfg.MaxImageDimension,
	})

	if !download &&
		(options.Width > 0 || options.Height > 0) &&
		options.Format != media.FormatOriginal &&
		media.Supports(extension) {
		result, err := s.thumbnails.Get(r.Context(), media.Request{
			SourcePath: full,
			CacheKey:   cacheKey,
			Width:      options.Width,
			Height:     options.Height,
			Quality:    options.Quality,
			Format:     options.Format,
			Cover:      options.Cover,
		})
		switch {
		case err == nil:
			serveThumbnail(w, r, result, cache)
			return nil
		case errors.Is(err, media.ErrTooLarge):
			return &APIError{Status: http.StatusUnprocessableEntity, Code: "image_too_large", Message: "图片超出缩略图尺寸限制"}
		case errors.Is(err, media.ErrUnsupported):
			// 回退为输出原始内容。
		default:
			return internalError(err)
		}
	}

	// ?as=pdf：把 pptx/ppt/doc（以及 docx 兜底）转成 PDF 后输出。
	// 下载请求永远返回原始文件，不经过转换。
	if !download && query.Get("as") == "pdf" {
		return s.serveConvertedDocument(w, r, full, info, cache)
	}

	return serveOriginal(w, r, full, info, download, cache)
}

// serveOriginal 输出原始文件。ETag 由大小与修改时间构成；HTML/SVG
// 额外加 sandbox CSP，避免同源脚本在预览域名下执行。
func serveOriginal(w http.ResponseWriter, r *http.Request, path string, info os.FileInfo, download bool, cache cachePolicy) error {
	f, err := os.Open(path)
	if err != nil {
		return notFound("文件不存在")
	}
	defer f.Close()

	header := w.Header()
	header.Set("ETag", `W/"`+strconv.FormatInt(info.Size(), 10)+`-`+strconv.FormatInt(info.ModTime().UnixMilli(), 10)+`"`)
	// 地址与内容短码绑定：内容变化即换地址，可按内容不可变长期缓存。
	header.Set("Cache-Control", cache.header())
	header.Set("Content-Disposition", contentDisposition(info.Name(), download))
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(info.Name())), ".")
	if extension == "html" || extension == "htm" || extension == "svg" {
		header.Set("Content-Security-Policy", "sandbox")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

// serveThumbnail 输出生成的缩略图；缩略图由缓存键寻址，可长期缓存。
func serveThumbnail(w http.ResponseWriter, r *http.Request, result media.Result, cache cachePolicy) {
	f, err := os.Open(result.Path)
	if err != nil {
		writeError(w, internalError(err))
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeError(w, internalError(err))
		return
	}
	header := w.Header()
	header.Set("Content-Type", result.ContentType)
	header.Set("ETag", result.ETag)
	// 缩略图地址由内容短码构成，内容变化即换地址，可按内容不可变长期缓存。
	header.Set("Cache-Control", cache.header())
	header.Set("Content-Disposition", "inline")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// contentDisposition 同时输出 ASCII 兜底名与 RFC 5987 的 UTF-8 名，
// 保证中文文件名在各浏览器都能正确落盘。
func contentDisposition(name string, attachment bool) string {
	kind := "inline"
	if attachment {
		kind = "attachment"
	}
	ascii := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	return kind + `; filename="` + ascii + `"; filename*=UTF-8''` + encodeRFC5987(name)
}

// encodeRFC5987 按 RFC 5987 规则百分号编码，仅保留 unreserved 字符。
func encodeRFC5987(value string) string {
	const digits = "0123456789ABCDEF"
	var b strings.Builder
	for _, c := range []byte(value) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			strings.ContainsRune("!#$&+-.^_`|~", rune(c)) {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(digits[c>>4])
		b.WriteByte(digits[c&0x0f])
	}
	return b.String()
}
