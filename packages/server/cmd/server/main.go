package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"vakao-static-hub/server/internal/auth"
	"vakao-static-hub/server/internal/config"
	"vakao-static-hub/server/internal/httpapi"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

// version 由构建时的 -ldflags "-X main.version=..." 覆盖。
var version = "0.0.1"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLogLevel(cfg.LogLevel),
	}))
	slog.SetDefault(logger)

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer func() {
		if err := st.Close(); err != nil {
			logger.Error("closing database", "error", err)
		}
	}()

	seedCtx, cancelSeed := context.WithTimeout(context.Background(), 15*time.Second)
	err = seedAdmin(seedCtx, st, cfg, logger)
	if err == nil {
		err = seedRoot(seedCtx, st, cfg, logger)
	}
	cancelSeed()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	handler := httpapi.New(cfg, st, logger, version)
	go handler.RunIndexer(ctx)
	go handler.RunScheduler(ctx)
	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("server listening",
			"addr", cfg.Addr(),
			"version", version,
			"baseDir", cfg.BaseDir,
			"dbPath", cfg.DBPath,
			"fileRoot", cfg.FileRoot,
			"webDir", cfg.WebDir,
		)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	logger.Info("server stopped")
	return nil
}

// seedAdmin 在 users 表为空时创建首个管理员。
// AUTH_PASS 为空表示「不播种」：部署时必须显式设置一次。
func seedAdmin(ctx context.Context, st *store.Store, cfg *config.Config, logger *slog.Logger) error {
	count, err := st.CountUsers(ctx)
	if err != nil {
		return fmt.Errorf("count users: %w", err)
	}
	if count > 0 {
		return nil
	}
	if strings.TrimSpace(cfg.AuthPass) == "" {
		logger.Warn("no users found and AUTH_PASS is empty; set AUTH_PASS to seed the first administrator")
		return nil
	}
	password := cfg.AuthPass
	if len(password) < 6 {
		return errors.New("AUTH_PASS must be at least 6 characters")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash admin password: %w", err)
	}
	if _, err := st.CreateUser(ctx, cfg.AuthUser, hash, "admin"); err != nil {
		return fmt.Errorf("create admin user: %w", err)
	}
	logger.Info("seeded administrator", "username", cfg.AuthUser)
	return nil
}

// seedRoot 在全新数据库上初始化资源根目录。
//
// 触发条件：只有数据库的根目录表为空（首次启动）时才播种；表中已有任何
// 根目录就直接返回，不会打开配置文件。
//
// 播种来源：cfg.ResourceRootsFile（默认 <BASE_DIR>/resource-roots.json）。
// 该文件可选——不存在时使用代码内置的 default（FILE_ROOT）与
// software-update（FILE_ROOT/software-update）两个根目录。
//
// 播种只发生一次：根目录写入数据库后即为唯一事实来源，后续启动不再读取
// 该文件；页面上的根目录增删改也只写数据库，不会回写文件。因此首次启动
// 完成后可以删除该文件，不影响运行，除非清空数据库重新播种。
func seedRoot(ctx context.Context, st *store.Store, cfg *config.Config, logger *slog.Logger) error {
	roots, err := st.ListRoots(ctx)
	if err != nil {
		return fmt.Errorf("list roots: %w", err)
	}
	if len(roots) > 0 {
		return nil
	}
	candidates, err := configuredRoots(cfg)
	if err != nil {
		return err
	}
	for _, root := range candidates {
		if err := os.MkdirAll(root.Path, 0o755); err != nil {
			return fmt.Errorf("create root %s: %w", root.ID, err)
		}
		if err := st.CreateRoot(ctx, root); err != nil {
			return fmt.Errorf("create root %s: %w", root.ID, err)
		}
		logger.Info("seeded resource root", "id", root.ID, "path", root.Path)
	}
	return nil
}

type rootEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description"`
}

// configuredRoots 解析播种用的根目录列表。
//
// 文件不存在属于正常情况（该文件可选），直接使用内置默认值；文件存在但
// 不是合法 JSON 数组时返回错误并中止启动，避免静默忽略写错的配置。
// 条目中的 path 相对路径按 BASE_DIR 解析，绝对路径原样使用。
func configuredRoots(cfg *config.Config) ([]model.ResourceRoot, error) {
	body, err := os.ReadFile(cfg.ResourceRootsFile)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return nil, fmt.Errorf("read resource roots file: %w", err)
	}
	entries := []rootEntry{
		{ID: "default", Name: "默认资源存储", Path: cfg.FileRoot},
		{ID: "software-update", Name: "APP 更新包", Path: filepath.Join(cfg.FileRoot, "software-update")},
	}
	if err == nil {
		var parsed []rootEntry
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("parse resource roots file: %w", err)
		}
		if len(parsed) > 0 {
			entries = parsed
		}
	}
	roots := make([]model.ResourceRoot, 0, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.ID) == "" || strings.TrimSpace(entry.Path) == "" {
			continue
		}
		roots = append(roots, model.ResourceRoot{
			ID:          entry.ID,
			Name:        entry.Name,
			Path:        storage.Resolve(cfg.BaseDir, entry.Path),
			Description: entry.Description,
		})
	}
	return roots, nil
}

func parseLogLevel(value string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
