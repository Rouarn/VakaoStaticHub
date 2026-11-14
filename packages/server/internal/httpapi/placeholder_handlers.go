package httpapi

import (
	"fmt"
	"html"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// handlePlaceholder 生成确定性的 SVG 占位图。尺寸来自
// 路径（或查询参数），并会被限制在合理范围内。
func (s *Server) handlePlaceholder(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	width := firstInt(pathValue(r, "width"), query.Get("width"), query.Get("w"), "600")
	height := firstInt(pathValue(r, "height"), query.Get("height"), query.Get("h"), "400")
	if size := strings.TrimSpace(pathValue(r, "size")); size != "" {
		square := firstInt(size, "", "", "400")
		width, height = square, square
	}
	width = clamp(width, 1, 4096)
	height = clamp(height, 1, 4096)

	text := query.Get("text")
	if text == "" {
		text = fmt.Sprintf("%d × %d", width, height)
	}
	bg := sanitizeColor(firstNonEmpty(query.Get("bgColor"), query.Get("bg")), "#e5e7eb")
	fg := sanitizeColor(firstNonEmpty(query.Get("textColor"), query.Get("fg")), "#374151")
	fontFamily := sanitizeFontFamily(query.Get("fontFamily"))
	fontWeight := sanitizeFontWeight(query.Get("fontWeight"))
	fontSize := clamp(firstInt(query.Get("fontSize"), "", "", "0"), 0, 512)
	if fontSize == 0 {
		fontSize = clamp(width/10, 12, 120)
	}

	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">`, width, height, width, height)
	fmt.Fprintf(&b, `<rect width="100%%" height="100%%" fill="%s"/>`, bg)
	fmt.Fprintf(&b, `<text x="50%%" y="50%%" fill="%s" font-family="%s" font-size="%d" font-weight="%s" text-anchor="middle" dominant-baseline="middle">%s</text>`,
		fg, fontFamily, fontSize, fontWeight, html.EscapeString(text))
	b.WriteString(`</svg>`)

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Security-Policy", "sandbox")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, b.String())
	return nil
}

func firstInt(values ...string) int {
	for _, value := range values {
		if n, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && n > 0 {
			return n
		}
	}
	return 0
}

func clamp(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func sanitizeColor(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if strings.HasPrefix(value, "#") && len(value) <= 9 {
		for _, c := range value[1:] {
			if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
				return fallback
			}
		}
		return value
	}
	switch value {
	case "transparent", "black", "white", "red", "green", "blue", "gray", "grey":
		return value
	}
	return fallback
}

func sanitizeFontFamily(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "sans-serif"
	}
	for _, c := range value {
		if !(c == '-' || c == ' ' || c == ',' || c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			return "sans-serif"
		}
	}
	if len(value) > 64 {
		return "sans-serif"
	}
	return value
}

func sanitizeFontWeight(value string) string {
	switch strings.TrimSpace(value) {
	case "100", "200", "300", "400", "500", "600", "700", "800", "900", "normal", "bold", "bolder", "lighter":
		return strings.TrimSpace(value)
	}
	return "600"
}
