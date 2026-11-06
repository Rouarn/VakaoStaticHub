package media

import (
	"net/url"
	"strconv"
	"strings"
)

// 图片尺寸与画质的统一约束。
// 所有图片接口都必须走 ParseOptions，禁止在其他位置重复实现
// 夹紧、量化或默认值回落的逻辑。
const (
	// MinDimension 与 MaxDimension 是可请求的宽高范围，越界值夹紧到边界。
	MinDimension = 16
	MaxDimension = 4096
	// DimensionStep 是宽高的对齐步长。
	// 请求尺寸先按该步长向下取整（483/487 都落到 480），
	// 把同一张图的零散尺寸收敛到同一份缓存，避免缓存条目膨胀。
	DimensionStep = 16
	// MinQuality 与 MaxQuality 是允许的画质范围，超出范围视为非法值。
	MinQuality     = 30
	MaxQuality     = 95
	DefaultQuality = 75
)

// 图片输出格式。original 表示不生成缩略图、直接输出原始文件。
const (
	FormatJPEG     = "jpeg"
	FormatPNG      = "png"
	FormatWebP     = "webp"
	FormatOriginal = "original"
)

// Options 是规范化后的图片生成参数。
// 宽高为 0 表示调用方未指定，此时由生成器按比例推导。
type Options struct {
	Width   int
	Height  int
	Quality int
	Format  string
	Cover   bool
}

// Defaults 是各接口的默认参数；查询参数缺失或非法时回落到这里。
type Defaults struct {
	Format       string
	Quality      int
	Cover        bool
	MaxDimension int
}

// ParseOptions 解析 w/h/q/format/cover 查询参数。
// 该函数永不失败：非法值回落默认、越界值夹紧，
// 保证地址里的参数写错时页面仍能正常显示图片。
func ParseOptions(values url.Values, defaults Defaults) Options {
	options := Options{
		Width:   parseDimension(values, "w", "width"),
		Height:  parseDimension(values, "h", "height"),
		Quality: parseQuality(values.Get("q"), defaults.Quality),
		Format:  parseFormat(values.Get("format"), defaults.Format),
		Cover:   parseCover(values.Get("cover"), defaults.Cover),
	}
	return options.Normalize(defaults.MaxDimension)
}

// Normalize 按统一约束夹紧并量化参数。
// 这是夹紧与量化的唯一实现，参数解析与缩略图生成两侧都复用它。
func (o Options) Normalize(maxDimension int) Options {
	limit := maxDimension
	if limit < MinDimension || limit > MaxDimension {
		limit = MaxDimension
	}
	o.Width = quantizeDimension(o.Width, limit)
	o.Height = quantizeDimension(o.Height, limit)
	if o.Quality < MinQuality || o.Quality > MaxQuality {
		o.Quality = DefaultQuality
	}
	switch o.Format {
	case FormatJPEG, FormatPNG, FormatWebP, FormatOriginal:
	default:
		o.Format = FormatJPEG
	}
	return o
}

// parseDimension 依次读取主参数与兼容别名，非法值按未指定处理。
func parseDimension(values url.Values, names ...string) int {
	for _, name := range names {
		raw := strings.TrimSpace(values.Get(name))
		if raw == "" {
			continue
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			continue
		}
		return value
	}
	return 0
}

// parseQuality 读取画质；缺失或超出允许范围时回落到默认画质。
func parseQuality(raw string, fallback int) int {
	if strings.TrimSpace(raw) == "" {
		return fallback
	}
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < MinQuality || value > MaxQuality {
		return fallback
	}
	return value
}

// parseFormat 只认 jpeg/png/webp（jpg 视为 jpeg）与 original，
// 其余无法识别的格式一律按 jpeg 输出。
func parseFormat(raw, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return fallback
	case "jpg", FormatJPEG:
		return FormatJPEG
	case FormatPNG:
		return FormatPNG
	case FormatWebP:
		return FormatWebP
	case FormatOriginal:
		return FormatOriginal
	default:
		return FormatJPEG
	}
}

// parseCover 只认 0/1，其他取值回落到接口默认值。
func parseCover(raw string, fallback bool) bool {
	switch strings.TrimSpace(raw) {
	case "1":
		return true
	case "0":
		return false
	default:
		return fallback
	}
}

// quantizeDimension 把单个宽高夹紧到允许区间后按步长向下对齐。
// 0 表示未指定，应保持为 0 交给生成器推导。
func quantizeDimension(value, limit int) int {
	if value <= 0 {
		return 0
	}
	if value < MinDimension {
		value = MinDimension
	}
	if value > limit {
		value = limit
	}
	value = value / DimensionStep * DimensionStep
	if value < MinDimension {
		value = MinDimension
	}
	return value
}
