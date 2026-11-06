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
	width, height := t.fit(req.Width, req.Height)
	format := strings.ToLower(req.Format)
	// 默认使用 JPEG：纯 Go 的 WebP 编码器是无损的，会生成
	// 更大的文件，因此仅在显式请求时使用（它能保留
	// 透明度，而 JPEG 不能）。
	if format != "webp" {
		format = "jpeg"
	}
	quality := req.Quality
	if quality <= 0 {
		quality = 75
	}
	if quality < 30 {
		quality = 30
	}
	if quality > 95 {
		quality = 95
	}

	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%d|%d|%d|%s|%t",
		req.CacheKey, info.Size(), info.ModTime().UnixMilli(), width, height, quality, format, req.Cover)))
	name := hex.EncodeToString(sum[:20])
	extension := ".webp"
	contentType := "image/webp"
	if format == "jpeg" {
		extension = ".jpg"
		contentType = "image/jpeg"
	}
	cachePath := filepath.Join(t.cacheDir, "thumbs", name[:2], name+extension)
	if fileExists(cachePath) {
		return Result{Path: cachePath, ContentType: contentType, ETag: `"t-` + name[:16] + `"`}, nil
	}

	select {
	case t.sem <- struct{}{}:
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
	defer func() { <-t.sem }()

	if fileExists(cachePath) {
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
	if req.Cover {
		scaled = imaging.Fill(img, width, height, imaging.Center, imaging.Lanczos)
	} else {
		scaled = imaging.Fit(img, width, height, imaging.Lanczos)
	}
	if format == "jpeg" {
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
	if format == "jpeg" {
		err = imaging.Encode(tmp, scaled, imaging.JPEG, imaging.JPEGQuality(quality))
	} else {
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

// fit 将请求的尺寸限制在配置上限内，同时保留
// 调用方的宽高意图（缺失的一边由另一边推导）。
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
	if t.maxDim > 0 {
		if width > t.maxDim {
			width = t.maxDim
		}
		if height > t.maxDim {
			height = t.maxDim
		}
	}
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
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
