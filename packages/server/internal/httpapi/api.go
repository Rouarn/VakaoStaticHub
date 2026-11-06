package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"vakao-static-hub/server/internal/auth"
	"vakao-static-hub/server/internal/config"
	"vakao-static-hub/server/internal/indexer"
	"vakao-static-hub/server/internal/media"
	"vakao-static-hub/server/internal/sharelink"
	"vakao-static-hub/server/internal/store"
	"vakao-static-hub/server/internal/upload"
)

// CurrentUser 是附加到请求上的已认证身份。
type CurrentUser struct {
	ID       int64
	Username string
	Role     string
}

func (u *CurrentUser) isAdmin() bool { return u != nil && u.Role == "admin" }

// Server 持有路由与依赖。所有依赖都在 New 中
// 显式构造，没有使用注入框架。
type Server struct {
	cfg     *config.Config
	store   *store.Store
	tokens  *auth.Manager
	log     *slog.Logger
	version string
	started time.Time
	mux     *http.ServeMux
	handler http.Handler

	indexer    *indexer.Indexer
	thumbnails *media.Thumbnailer
	uploads    *upload.Manager

	shareTokens   *sharelink.Manager
	shareLimiter  *rateLimiter
	hitokotoCache hitokotoCache
	qps           qpsMeter

	loginLimiter *rateLimiter
}

func New(cfg *config.Config, st *store.Store, logger *slog.Logger, version string) *Server {
	s := &Server{
		cfg:           cfg,
		store:         st,
		tokens:        auth.NewManager(cfg.JWTSecret, cfg.JWTExpires),
		log:           logger,
		version:       version,
		started:       time.Now(),
		mux:           http.NewServeMux(),
		loginLimiter:  newRateLimiter(5, time.Minute),
		shareLimiter:  newRateLimiter(10, time.Minute),
		shareTokens:   sharelink.NewManager(cfg.JWTSecret, 30*time.Minute),
		indexer:       indexer.New(st),
		thumbnails:    media.NewThumbnailer(cfg.CacheDir, cfg.MaxImagePixels, cfg.MaxImageDimension, cfg.ThumbConcurrency),
		uploads:       upload.New(cfg.UploadTempDir),
		hitokotoCache: hitokotoCache{entries: make(map[string]hitokotoEntry)},
	}
	s.routes()
	s.handler = chain(s.mux,
		withRequestID,
		recoverMiddleware(logger),
		loggingMiddleware{log: logger, trustProxy: cfg.TrustProxy}.handle,
		securityHeadersMiddleware,
		corsMiddleware(cfg.CORSOrigin),
	)
	go s.logContract()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.qps.hit()
	s.handler.ServeHTTP(&apiErrorShape{ResponseWriter: w, path: r.URL.Path}, r)
}

// handleFunc 是请求处理函数的签名：返回 error，而不是
// 手写错误响应。
type handleFunc func(w http.ResponseWriter, r *http.Request, user *CurrentUser) error

func (s *Server) public(fn handleFunc) http.Handler {
	return s.wrap(Public, fn)
}

func (s *Server) user(fn handleFunc) http.Handler {
	return s.wrap(User, fn)
}

func (s *Server) admin(fn handleFunc) http.Handler {
	return s.wrap(Admin, fn)
}

func (s *Server) wrap(level AuthLevel, fn handleFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var user *CurrentUser
		if level != Public {
			u, err := s.authenticate(r)
			if err != nil {
				s.fail(w, r, err)
				return
			}
			if level == Admin && !u.isAdmin() {
				s.fail(w, r, forbidden("administrator role required"))
				return
			}
			user = &u
		}
		if err := fn(w, r, user); err != nil {
			s.fail(w, r, err)
		}
	})
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	apiErr := asAPIError(err)
	if apiErr.Status >= http.StatusInternalServerError {
		s.log.Error("request failed",
			"error", err,
			"path", r.URL.Path,
			"method", r.Method,
			"requestId", requestIDFrom(r.Context()),
		)
	}
	writeError(w, apiErr)
}

func (s *Server) authenticate(r *http.Request) (CurrentUser, error) {
	claims, err := s.tokens.TokenFromHeader(r.Header.Get("Authorization"))
	if err != nil {
		return CurrentUser{}, unauthorized("missing or invalid bearer token")
	}
	record, err := s.store.UserByID(r.Context(), claims.Sub)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return CurrentUser{}, unauthorized("user no longer exists")
		}
		return CurrentUser{}, internalError(err)
	}
	// 修改密码会更新 updated_at；早于该时间签发的 Token
	// 无需服务端黑名单即会失效。
	if record.UpdatedAtMS > claims.IatMS {
		return CurrentUser{}, unauthorized("token has been revoked")
	}
	return CurrentUser{ID: record.ID, Username: record.Username, Role: record.Role}, nil
}

func (s *Server) routes() {
	s.mux.Handle("GET /healthz", s.public(s.handleHealth))

	s.mux.Handle("POST /api/v1/auth/login", s.public(s.handleLogin))
	s.mux.Handle("GET /api/v1/auth/me", s.user(s.handleMe))
	s.mux.Handle("POST /api/v1/auth/logout", s.user(s.handleLogout))
	s.mux.Handle("PATCH /api/v1/auth/password", s.user(s.handleChangePassword))

	s.mux.Handle("GET /api/v1/users", s.admin(s.handleListUsers))
	s.mux.Handle("POST /api/v1/users", s.admin(s.handleCreateUser))
	s.mux.Handle("PATCH /api/v1/users/{id}/password", s.admin(s.handleResetPassword))
	s.mux.Handle("DELETE /api/v1/users/{id}", s.admin(s.handleDeleteUser))

	s.mux.Handle("GET /api/v1/roots", s.user(s.handleListRoots))
	s.mux.Handle("POST /api/v1/roots", s.user(s.handleCreateRoot))
	s.mux.Handle("PATCH /api/v1/roots/{id}", s.user(s.handleUpdateRoot))
	s.mux.Handle("DELETE /api/v1/roots/{id}", s.user(s.handleDeleteRoot))
	s.mux.Handle("GET /api/v1/roots/browse", s.user(s.handleBrowse))
	s.mux.Handle("GET /api/v1/roots/browse/bounds", s.user(s.handleBrowseBounds))

	s.mux.Handle("GET /api/v1/files/config", s.user(s.handleFileConfig))
	s.mux.Handle("GET /api/v1/files", s.user(s.handleListFiles))
	s.mux.Handle("GET /api/v1/files/categories", s.user(s.handleListCategories))
	s.mux.Handle("POST /api/v1/files/categories", s.user(s.handleCreateCategory))
	s.mux.Handle("PATCH /api/v1/files/categories", s.user(s.handleRenameCategory))
	s.mux.Handle("DELETE /api/v1/files/categories", s.user(s.handleDeleteCategory))
	s.mux.Handle("GET /api/v1/files/stats", s.user(s.handleFileStats))
	s.mux.Handle("GET /api/v1/files/duplicates", s.user(s.handleDuplicates))
	s.mux.Handle("POST /api/v1/files/index", s.user(s.handleReindex))
	s.mux.Handle("POST /api/v1/files/batch-delete", s.user(s.handleBatchDelete))
	s.mux.Handle("POST /api/v1/files/batch-move", s.user(s.handleBatchMove))
	s.mux.Handle("PATCH /api/v1/files/rename", s.user(s.handleRenameFile))
	s.mux.Handle("DELETE /api/v1/files", s.user(s.handleDeleteFile))
	s.mux.Handle("GET /api/v1/files/content/{rootId}/{category}/{path...}", s.public(s.handleFileContent))

	s.mux.Handle("POST /api/v1/files/upload", s.user(s.handleMultipartUpload))
	s.mux.Handle("POST /api/v1/uploads", s.user(s.handleInitChunk))
	s.mux.Handle("PUT /api/v1/uploads/{id}/chunks/{index}", s.user(s.handleUploadChunk))
	s.mux.Handle("POST /api/v1/uploads/{id}/complete", s.user(s.handleCompleteChunk))
	s.mux.Handle("DELETE /api/v1/uploads/{id}", s.user(s.handleCancelChunk))

	s.mux.Handle("GET /api/v1/shares", s.user(s.handleListShares))
	s.mux.Handle("POST /api/v1/shares", s.user(s.handleCreateShare))
	s.mux.Handle("PATCH /api/v1/shares/{token}", s.user(s.handleUpdateShare))
	s.mux.Handle("DELETE /api/v1/shares/{token}", s.user(s.handleDeleteShare))
	s.mux.Handle("GET /api/v1/shares/{token}/access-logs", s.user(s.handleShareAccessLogs))

	s.mux.Handle("GET /api/v1/public/shares/{token}", s.public(s.handlePublicShareInfo))
	s.mux.Handle("POST /api/v1/public/shares/{token}/unlock", s.public(s.handleUnlockShare))
	s.mux.Handle("GET /api/v1/public/shares/{token}/files", s.public(s.handleShareFiles))
	s.mux.Handle("GET /api/v1/public/shares/{token}/files/{index}", s.public(s.handleShareFileContent))

	s.mux.Handle("GET /api/v1/apps", s.user(s.handleListApps))
	s.mux.Handle("POST /api/v1/apps", s.user(s.handleCreateApp))
	s.mux.Handle("PATCH /api/v1/apps/{appKey}", s.user(s.handleUpdateApp))
	s.mux.Handle("DELETE /api/v1/apps/{appKey}", s.user(s.handleDeleteApp))
	s.mux.Handle("GET /api/v1/apps/{appKey}/versions", s.user(s.handleListVersions))
	s.mux.Handle("POST /api/v1/apps/{appKey}/versions", s.user(s.handleCreateVersion))
	s.mux.Handle("GET /api/v1/app-versions/{id}", s.user(s.handleVersionDetail))
	s.mux.Handle("PATCH /api/v1/app-versions/{id}", s.user(s.handleUpdateVersion))
	s.mux.Handle("DELETE /api/v1/app-versions/{id}", s.user(s.handleDeleteVersion))
	s.mux.Handle("POST /api/v1/app-versions/{id}/publish", s.user(s.handlePublishVersion))
	s.mux.Handle("POST /api/v1/app-versions/{id}/offline", s.user(s.handleOfflineVersion))
	s.mux.Handle("POST /api/v1/app-versions/{id}/rollback", s.user(s.handleRollbackVersion))
	s.mux.Handle("PUT /api/v1/app-versions/{id}/force", s.user(s.handleForceVersion))
	s.mux.Handle("GET /api/v1/app-versions/{id}/rollback-candidates", s.user(s.handleRollbackCandidates))
	s.mux.Handle("GET /api/v1/apps/{appKey}/funnel", s.user(s.handleAppFunnel))

	s.mux.Handle("GET /api/v1/public/apps/{appKey}/update", s.public(s.handleCheckUpdate))
	s.mux.Handle("GET /api/v1/public/apps/versions/{id}/download", s.public(s.handleDownloadPackage))
	s.mux.Handle("POST /api/v1/public/apps/events", s.public(s.handleReportEvents))

	s.mux.Handle("GET /api/v1/audit-logs", s.user(s.handleAuditLogs))
	s.mux.Handle("GET /api/v1/metrics", s.user(s.handleMetrics))
	s.mux.Handle("GET /api/v1/metrics/sidebar", s.user(s.handleMetricsSidebar))

	s.mux.Handle("GET /api/v1/public/hitokoto", s.public(s.handleHitokoto))
	s.mux.Handle("GET /api/v1/public/photo", s.public(s.handleRandomPhoto))
	s.mux.Handle("GET /api/v1/public/placeholder", s.public(s.handlePlaceholder))
	s.mux.Handle("GET /api/v1/public/placeholder/{width}/{height}", s.public(s.handlePlaceholder))
	s.mux.Handle("GET /api/v1/public/placeholder/{size}", s.public(s.handlePlaceholder))

	s.mountSPA()
}

// RunIndexer 先执行一次初始扫描，之后按
// 配置的间隔刷新索引。它会阻塞直到 ctx 被取消，
// 应在独立的 goroutine 中启动。
func (s *Server) RunIndexer(ctx context.Context) {
	scan := func() {
		result, err := s.indexer.ScanAll(ctx)
		if err != nil {
			if ctx.Err() == nil {
				s.log.Error("index scan failed", "error", err)
			}
			return
		}
		s.log.Info("index refreshed",
			"indexed", result.Indexed,
			"removed", result.Removed,
			"durationMs", result.DurationMS,
		)
	}
	scan()
	ticker := time.NewTicker(s.cfg.CacheRefresh)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			scan()
		}
	}
}

// RunScheduler 处理定时发布、灰度递增与
// 过期的上传会话，应在独立的 goroutine 中运行。
func (s *Server) RunScheduler(ctx context.Context) {
	s.processScheduled(ctx)
	s.processGrayRollouts(ctx)

	minute := time.NewTicker(time.Minute)
	defer minute.Stop()
	cleanup := time.NewTicker(time.Hour)
	defer cleanup.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-minute.C:
			s.processScheduled(ctx)
			s.processGrayRollouts(ctx)
		case <-cleanup.C:
			if removed := s.uploads.Cleanup(24 * time.Hour); removed > 0 {
				s.log.Info("stale upload sessions removed", "count", removed)
			}
		}
	}
}

func (s *Server) processScheduled(ctx context.Context) {
	now := time.Now()
	records, err := s.store.DueScheduledVersions(ctx, now.UnixMilli())
	if err != nil {
		s.log.Error("load scheduled versions failed", "error", err)
		return
	}
	for _, record := range records {
		percent := 100
		if record.ScheduledPublishMode == "gray" && record.ScheduledGrayPercent > 0 {
			percent = record.ScheduledGrayPercent
		}
		if err := s.store.PublishVersion(ctx, record.ID, percent, now.UnixMilli()); err != nil {
			s.log.Error("scheduled publish failed", "error", err, "versionId", record.ID)
			continue
		}
		s.log.Info("scheduled version published", "versionId", record.ID, "grayPercent", percent)
	}
}

func (s *Server) processGrayRollouts(ctx context.Context) {
	records, err := s.store.GrayAutoVersions(ctx)
	if err != nil {
		s.log.Error("load gray rollouts failed", "error", err)
		return
	}
	now := time.Now()
	for _, record := range records {
		if record.PublishTime == nil || len(record.GrayIncrementSchedule) == 0 {
			continue
		}
		elapsedMinutes := int(now.Sub(*record.PublishTime).Minutes())
		if elapsedMinutes < 0 {
			continue
		}
		target := record.GrayPercent
		for _, step := range record.GrayIncrementSchedule {
			if step.AfterMinutes <= elapsedMinutes && step.Percent > target {
				target = step.Percent
			}
		}
		if target <= record.GrayPercent {
			continue
		}
		if err := s.store.SetGrayPercent(ctx, record.ID, target); err != nil {
			s.log.Error("gray increment failed", "error", err, "versionId", record.ID)
			continue
		}
		s.log.Info("gray rollout advanced", "versionId", record.ID, "percent", target)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request, _ *CurrentUser) error {
	writeJSON(w, map[string]any{
		"status":        "ok",
		"version":       s.version,
		"uptimeSeconds": int64(time.Since(s.started).Seconds()),
	})
	return nil
}
func (s *Server) logContract() {
	live := 0
	for _, entry := range contractEntries {
		if entry.Implemented {
			live++
		}
	}
	s.log.Info("http contract loaded",
		"routes", len(contractEntries),
		"implemented", live,
		"pending", len(contractEntries)-live,
	)
}
