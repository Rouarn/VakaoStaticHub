// 包 config 把环境变量（以及可选的 .env 回退）收敛为一份不可变的
// 运行时配置。
//
// 约定：进程环境变量优先于 .env；相对路径一律按 BaseDir 解析；
// 非法或危险的配置在 Load 阶段直接报错，而不是带着错误值启动。
package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Config 是完整的运行时配置。取值来自进程
// 环境变量，.env 文件作为可选的回退来源。
type Config struct {
	BaseDir string

	Host string
	Port int

	WebDir   string
	DBPath   string
	FileRoot string
	// ResourceRootsFile 是可选的根目录播种文件（RESOURCE_ROOTS_FILE，
	// 默认 <BASE_DIR>/resource-roots.json，相对路径按 BASE_DIR 解析）。
	// 它只在数据库根目录表为空（全新部署首启）时被读取一次，用来播种
	// 根目录；之后启动不再读取，页面上的根目录增删改只写数据库、不回写文件。
	ResourceRootsFile string
	UploadTempDir     string
	CacheDir          string

	MaxUploadCount    int
	ChunkSizeLimit    int64
	DefaultCategory   string
	CacheRefresh      time.Duration
	MaxImagePixels    int64
	MaxImageDimension int
	ThumbConcurrency  int

	// ThumbRetention 为缩略图缓存保留时长，0 表示不按时间清理；
	// ThumbCacheMax 为缓存总容量上限（字节），0 表示不限制；
	// CleanupHour/CleanupMinute 为每日清理时刻。
	ThumbRetention time.Duration
	ThumbCacheMax  int64
	CleanupHour    int
	CleanupMinute  int

	// Office 文档转 PDF（pptx/ppt/doc 与 docx 兜底）的参数。
	// SofficePath 为空时退回 PATH 中的 soffice；OfficeCacheDir 是转换缓存
	// 根目录，默认落在系统临时目录，交给系统按需回收，回收后重新转换即可。
	OfficeConcurrency int
	OfficeTimeout     time.Duration
	OfficeMaxInput    int64
	OfficeCacheDir    string
	SofficePath       string

	JWTSecret  string
	JWTExpires time.Duration
	AuthUser   string
	AuthPass   string

	// ShareSignKey 是公开分享文件地址的签名密钥（SHARE_SIGN_KEY）。
	// 换掉它等于让所有旧的文件地址签名一次性作废。
	ShareSignKey string

	// CDN 缓存刷新凭据（EdgeOne）；任一项为空即不刷新，靠缓存 TTL 兜底。
	TencentSecretID  string
	TencentSecretKey string
	EdgeOneZoneID    string

	CORSOrigin    string
	TrustProxy    bool
	LogLevel      string
	HitokotoURL   string
	AppPublicBase string

	// BrowseWhitelist 保存根目录浏览器额外允许访问的绝对目录
	// （对应 ROOT_BROWSE_WHITELIST，逗号分隔）。
	BrowseWhitelist []string
}

// Load 读取当前目录下的 .env（若存在），随后应用
// 进程环境变量覆盖。相对路径以 BaseDir 为基准解析。
func Load() (*Config, error) {
	base, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	if v := os.Getenv("BASE_DIR"); v != "" {
		base, err = filepath.Abs(v)
		if err != nil {
			return nil, err
		}
	}
	_ = loadDotEnv(filepath.Join(base, ".env"))

	cleanupHour, cleanupMinute, err := parseClock(env("CLEANUP_AT", "03:00"))
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		BaseDir:           base,
		Host:              env("HOST", "0.0.0.0"),
		Port:              envInt("PORT", 9865),
		WebDir:            resolve(base, env("WEB_DIR", "web")),
		DBPath:            resolve(base, env("DB_PATH", "data/vakao.db")),
		FileRoot:          resolve(base, env("FILE_ROOT", "data")),
		ResourceRootsFile: resolve(base, env("RESOURCE_ROOTS_FILE", "resource-roots.json")),
		UploadTempDir:     resolve(base, env("UPLOAD_TEMP_DIR", "data/.uploads")),
		CacheDir:          resolve(base, env("CACHE_DIR", "data/.cache")),
		MaxUploadCount:    envInt("UPLOAD_MAX_COUNT", 20),
		ChunkSizeLimit:    envInt64("CHUNK_FILE_SIZE_LIMIT", 100*1024*1024),
		DefaultCategory:   env("DEFAULT_CATEGORY", "TemporaryFile"),
		CacheRefresh:      time.Duration(envInt64("CACHE_REFRESH_INTERVAL_MS", 5*60*1000)) * time.Millisecond,
		MaxImagePixels:    envInt64("MAX_IMAGE_PIXELS", 60_000_000),
		MaxImageDimension: envInt("MAX_IMAGE_DIMENSION", 4096),
		ThumbConcurrency:  envInt("THUMB_CONCURRENCY", 2),
		ThumbRetention:    time.Duration(envInt("THUMB_CACHE_RETENTION_DAYS", 30)) * 24 * time.Hour,
		ThumbCacheMax:     envInt64("THUMB_CACHE_MAX_MB", 512) * 1024 * 1024,
		CleanupHour:       cleanupHour,
		CleanupMinute:     cleanupMinute,
		OfficeConcurrency: envInt("OFFICE_CONVERT_CONCURRENCY", 2),
		OfficeTimeout:     envDuration("OFFICE_CONVERT_TIMEOUT", 90*time.Second),
		OfficeMaxInput:    envInt64("OFFICE_MAX_INPUT_MB", 20) * 1024 * 1024,
		OfficeCacheDir:    resolve(base, env("OFFICE_CACHE_DIR", filepath.Join(os.TempDir(), "vakao-static-hub-office"))),
		SofficePath:       env("SOFFICE_PATH", "soffice"),
		JWTSecret:         os.Getenv("JWT_SECRET"),
		ShareSignKey:      os.Getenv("SHARE_SIGN_KEY"),
		TencentSecretID:   os.Getenv("TENCENTCLOUD_SECRET_ID"),
		TencentSecretKey:  os.Getenv("TENCENTCLOUD_SECRET_KEY"),
		EdgeOneZoneID:     os.Getenv("EDGEONE_ZONE_ID"),
		JWTExpires:        envDuration("JWT_EXPIRES_IN", 12*time.Hour),
		AuthUser:          env("AUTH_USER", "admin"),
		AuthPass:          env("AUTH_PASS", ""),
		CORSOrigin:        os.Getenv("CORS_ORIGIN"),
		TrustProxy:        envBool("TRUST_PROXY", false),
		LogLevel:          env("LOG_LEVEL", "info"),
		HitokotoURL:       env("HITOKOTO_API_URL", "https://static.shixian.xyz/static/hitokoto"),
		AppPublicBase:     strings.TrimRight(os.Getenv("APP_PUBLIC_BASE_URL"), "/"),
		BrowseWhitelist:   splitList(os.Getenv("ROOT_BROWSE_WHITELIST")),
	}
	if cfg.JWTSecret == "" || cfg.JWTSecret == "change-me-in-env" {
		return nil, errors.New("JWT_SECRET must be set to a non-default value")
	}
	if len(cfg.JWTSecret) < 16 {
		return nil, errors.New("JWT_SECRET must be at least 16 bytes")
	}
	if len(cfg.ShareSignKey) < 16 {
		return nil, errors.New("SHARE_SIGN_KEY must be at least 16 bytes")
	}
	if cfg.MaxUploadCount < 1 {
		return nil, errors.New("UPLOAD_MAX_COUNT must be positive")
	}
	if cfg.ChunkSizeLimit < 1 {
		return nil, errors.New("CHUNK_FILE_SIZE_LIMIT must be positive")
	}
	if cfg.ThumbConcurrency < 1 {
		cfg.ThumbConcurrency = 1
	}
	if cfg.ThumbRetention < 0 {
		return nil, errors.New("THUMB_CACHE_RETENTION_DAYS must not be negative")
	}
	if cfg.ThumbCacheMax < 0 {
		return nil, errors.New("THUMB_CACHE_MAX_MB must not be negative")
	}
	if cfg.OfficeConcurrency < 1 {
		cfg.OfficeConcurrency = 1
	}
	if cfg.OfficeTimeout <= 0 {
		return nil, errors.New("OFFICE_CONVERT_TIMEOUT must be positive")
	}
	if cfg.OfficeMaxInput < 1 {
		return nil, errors.New("OFFICE_MAX_INPUT_MB must be positive")
	}
	return cfg, nil
}

// parseClock 解析 HH:MM 形式的每日时刻。
func parseClock(value string) (int, int, error) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("CLEANUP_AT must use HH:MM format, got %q", value)
	}
	hour, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || hour < 0 || hour > 23 {
		return 0, 0, fmt.Errorf("CLEANUP_AT has invalid hour %q", value)
	}
	minute, err := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err != nil || minute < 0 || minute > 59 {
		return 0, 0, fmt.Errorf("CLEANUP_AT has invalid minute %q", value)
	}
	return hour, minute, nil
}

// Addr 返回 http.Server 监听地址，格式为 host:port。
func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}

// resolve 把配置里的相对路径按 base 展开为绝对路径；绝对路径只做 Clean。
func resolve(base, value string) string {
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	return filepath.Join(base, value)
}

// loadDotEnv 读取 KEY=VALUE 形式的 .env 并补齐尚未设置的环境变量。
// 文件不存在不是错误；已存在的环境变量不会被覆盖，因此容器或
// systemd 注入的值始终优先。
func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		v = strings.Trim(v, `"'`)
		if _, exists := os.LookupEnv(k); !exists {
			_ = os.Setenv(k, v)
		}
	}
	return sc.Err()
}

// env 读取非空环境变量，空串按未设置处理并返回 fallback。
func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

// envInt 读取整数环境变量；缺失或解析失败时返回 fallback，
// 不在读取阶段报错，范围校验交给 Load。
func envInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return fallback
}

// envInt64 是 envInt 的 int64 版本，用于文件大小等大数值配置。
func envInt64(key string, fallback int64) int64 {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

// envBool 解析布尔环境变量，接受 strconv.ParseBool 支持的形式；
// 缺失或无法解析时返回 fallback。
func envBool(key string, fallback bool) bool {
	if v, ok := os.LookupEnv(key); ok {
		if b, err := strconv.ParseBool(strings.TrimSpace(v)); err == nil {
			return b
		}
	}
	return fallback
}

// envDuration 按 time.ParseDuration 解析时长（如 30m、720h）；
// 缺失或无法解析时返回 fallback。
func envDuration(key string, fallback time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok {
		if d, err := time.ParseDuration(strings.TrimSpace(v)); err == nil {
			return d
		}
	}
	return fallback
}

// splitList 按逗号切分列表配置，去除空白与空项。
func splitList(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
