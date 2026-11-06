package media

import (
	"net/url"
	"testing"
)

// TestParseOptions 校验统一的参数规则：越界夹紧、按步长量化、
// 非法值回落默认，任何输入都不会返回错误。
func TestParseOptions(t *testing.T) {
	defaults := Defaults{Format: FormatJPEG, Quality: DefaultQuality, MaxDimension: MaxDimension}

	cases := []struct {
		name  string
		query string
		want  Options
	}{
		{"未指定尺寸", "", Options{Quality: DefaultQuality, Format: FormatJPEG}},
		{"对齐后的尺寸保持不变", "w=480&h=480", Options{Width: 480, Height: 480, Quality: DefaultQuality, Format: FormatJPEG}},
		{"向下量化到步长", "w=483&h=487", Options{Width: 480, Height: 480, Quality: DefaultQuality, Format: FormatJPEG}},
		{"超出上限夹紧", "w=99999&h=99999", Options{Width: 4096, Height: 4096, Quality: DefaultQuality, Format: FormatJPEG}},
		{"低于下限夹紧", "w=1&h=3", Options{Width: 16, Height: 16, Quality: DefaultQuality, Format: FormatJPEG}},
		{"兼容 width/height 别名", "width=320&height=240", Options{Width: 320, Height: 240, Quality: DefaultQuality, Format: FormatJPEG}},
		{"非法格式回落 jpeg", "format=bmp", Options{Quality: DefaultQuality, Format: FormatJPEG}},
		{"jpg 视为 jpeg", "format=jpg", Options{Quality: DefaultQuality, Format: FormatJPEG}},
		{"支持 png", "format=png", Options{Quality: DefaultQuality, Format: FormatPNG}},
		{"支持 webp", "format=webp", Options{Quality: DefaultQuality, Format: FormatWebP}},
		{"original 原样保留", "format=original", Options{Quality: DefaultQuality, Format: FormatOriginal}},
		{"画质越界回落默认", "q=999", Options{Quality: DefaultQuality, Format: FormatJPEG}},
		{"画质过小回落默认", "q=10", Options{Quality: DefaultQuality, Format: FormatJPEG}},
		{"画质合法直接采用", "q=50", Options{Quality: 50, Format: FormatJPEG}},
		{"cover=1 生效", "cover=1", Options{Quality: DefaultQuality, Format: FormatJPEG, Cover: true}},
		{"cover 非法取默认", "cover=abc", Options{Quality: DefaultQuality, Format: FormatJPEG}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			values, err := url.ParseQuery(tc.query)
			if err != nil {
				t.Fatalf("解析查询串失败: %v", err)
			}
			if got := ParseOptions(values, defaults); got != tc.want {
				t.Fatalf("ParseOptions(%q) = %+v，期望 %+v", tc.query, got, tc.want)
			}
		})
	}
}
