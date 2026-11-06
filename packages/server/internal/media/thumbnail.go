package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/HugoSmits86/nativewebp"
	"github.com/disintegration/imaging"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

var (
	ErrTooLarge    = errors.New("image dimensions exceed the configured limit")
	ErrUnsupported = errors.New("image format cannot be thumbnailed")
)

var thumbableExtensions = map[string]struct{}{
	"jpg": {}, "jpeg": {}, "png": {}, "gif": {}, "webp": {}, "tif": {}, "tiff": {},
}

// Supports 判断某扩展名能否解码生成缩略图。AVIF 被
// 有意排除：这类文件会原样输出。
func Supports(extension string) bool {
	_, ok := thumbableExtensions[strings.ToLower(extension)]
	return ok
}

type Thumbnailer struct {
	cacheDir  string
	maxPixels int64
	maxDim    int
	sem       chan struct{}
}

func NewThumbnailer(cacheDir string, maxPixels int64, maxDim, concurrency int) *Thumbnailer {
	if concurrency < 1 {
		concurrency = 1
	}
	return &Thumbnailer{
		cacheDir:  cacheDir,
		maxPixels: maxPixels,
		maxDim:    maxDim,
		sem:       make(chan struct{}, concurrency),
	}
}

type Request struct {
	SourcePath string
	// CacheKey 标识库中的源文件（root/category/relPath）。
	CacheKey string
	Width    int
	Height   int
	Quality  int
	Format   string // "webp" 或 "jpeg"（默认 jpeg）
	// Cover 为 true 时裁剪填满目标尺寸（旧版随机图语义），
	// 否则按比例缩放到尺寸范围内。
	Cover bool
}

type Result struct {
	Path        string
	ContentType string
	ETag        string
}

func (t *Thumbnailer) Get(ctx context.Context, req Request) (Result, error) {
	info, err := os.Stat(req.SourcePath)
	if err != nil {
		return Result{}, err
	}
	// 复用统一的夹紧与量化规则：即使调用方直接构造 Request，
	// 也不会绕过尺寸、画质与格式的约束。
	options := Options{
		Width:   req.Width,
		Height:  req.Height,
		Quality: req.Quality,
		Format:  req.Format,
		Cover:   req.Cover,
	}.Normalize(t.maxDim)
	width, height := t.fit(options.Width, options.Height)
	format := options.Format
	quality := options.Quality
	// 仅 jpeg/png/webp 会真正编码；original 由调用方提前处理，
	// 漏传时按 jpeg 兜底。
	if format != FormatWebP && format != FormatPNG {
		format = FormatJPEG
	}

	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%d|%d|%d|%s|%t",
		req.CacheKey, info.Size(), info.ModTime().UnixMilli(), width, height, quality, format, options.Cover)))
	name := hex.EncodeToString(sum[:20])
	extension := ".jpg"
	contentType := "image/jpeg"
	switch format {
	case FormatWebP:
		extension = ".webp"
		contentType = "image/webp"
	case FormatPNG:
		extension = ".png"
		contentType = "image/png"
	}
	cachePath := filepath.Join(t.cacheDir, "thumbs", name[:2], name+extension)
	if fileExists(cachePath) {
		touchFile(cachePath)
		return Result{Path: cachePath, ContentType: contentType, ETag: `"t-` + name[:16] + `"`}, nil
	}

	select {
	case t.sem <- struct{}{}:
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
	defer func() { <-t.sem }()

	if fileExists(cachePath) {
		touchFile(cachePath)
		return Result{Path: cachePath, ContentType: contentType, ETag: `"t-` + name[:16] + `"`}, nil
	}

	source, err := os.Open(req.SourcePath)
	if err != nil {
		return Result{}, err
	}
	cfg, _, err := image.DecodeConfig(source)
	source.Close()
	if err != nil {
		return Result{}, ErrUnsupported
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > t.maxPixels {
		return Result{}, ErrTooLarge
	}

	source, err = os.Open(req.SourcePath)
	if err != nil {
		return Result{}, err
	}
	img, err := imaging.Decode(source, imaging.AutoOrientation(true))
	source.Close()
	if err != nil {
		return Result{}, ErrUnsupported
	}

	var scaled image.Image
	if options.Cover {
		scaled = imaging.Fill(img, width, height, imaging.Center, imaging.Lanczos)
	} else {
		scaled = imaging.Fit(img, width, height, imaging.Lanczos)
	}
	// JPEG 不支持透明通道，先铺白底，避免透明区域变黑。
	if format == FormatJPEG {
		background := imaging.New(scaled.Bounds().Dx(), scaled.Bounds().Dy(), color.White)
		scaled = imaging.Overlay(background, scaled, image.Pt(0, 0), 1)
	}
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return Result{}, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(cachePath), ".tmp-*")
	if err != nil {
		return Result{}, err
	}
	tmpName := tmp.Name()
	cleanup := func() {
		tmp.Close()
		os.Remove(tmpName)
	}
	switch format {
	case FormatJPEG:
		err = imaging.Encode(tmp, scaled, imaging.JPEG, imaging.JPEGQuality(quality))
	case FormatPNG:
		err = imaging.Encode(tmp, scaled, imaging.PNG)
	default:
		err = nativewebp.Encode(tmp, scaled, &nativewebp.Options{CompressionLevel: webpLevel(quality)})
	}
	if err != nil {
		cleanup()
		return Result{}, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return Result{}, err
	}
	if err := os.Rename(tmpName, cachePath); err != nil {
		os.Remove(tmpName)
		return Result{}, err
	}
	return Result{Path: cachePath, ContentType: contentType, ETag: `"t-` + name[:16] + `"`}, nil
}

// fit 推导缺失的一边：宽高都缺失时使用 320 的方形默认值，
// 只缺一边时按另一边补齐。夹紧与量化已由 Normalize 完成。
func (t *Thumbnailer) fit(width, height int) (int, int) {
	if width <= 0 && height <= 0 {
		width, height = 320, 320
	}
	if width <= 0 {
		width = height
	}
	if height <= 0 {
		height = width
	}
	return width, height
}

func webpLevel(quality int) nativewebp.CompressionLevel {
	switch {
	case quality >= 85:
		return nativewebp.CompressionLevel(6)
	case quality >= 60:
		return nativewebp.CompressionLevel(4)
	default:
		return nativewebp.CompressionLevel(2)
	}
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// touchFile 把缓存的修改时间更新为当前时间，作为
// 「最近访问」标记供清理任务判断冷热。
func touchFile(path string) {
	now := time.Now()
	_ = os.Chtimes(path, now, now)
}
