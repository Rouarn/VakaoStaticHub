package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"vakao-static-hub/server/internal/indexer"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

func (s *Server) handleFileConfig(w http.ResponseWriter, _ *http.Request, _ *CurrentUser) error {
	writeJSON(w, model.FileConfig{
		MaxUploadCount:    s.cfg.MaxUploadCount,
		ChunkSizeLimit:    s.cfg.ChunkSizeLimit,
		DefaultCategory:   s.cfg.DefaultCategory,
		MaxImagePixels:    s.cfg.MaxImagePixels,
		MaxImageDimension: s.cfg.MaxImageDimension,
		CacheRefreshMS:    s.cfg.CacheRefresh.Milliseconds(),
	})
	return nil
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	query := r.URL.Query()
	rootID := strings.TrimSpace(query.Get("rootId"))
	if rootID == "" {
		return badRequest("rootId 不能为空")
	}
	if _, err := s.rootByID(r.Context(), rootID); err != nil {
		return err
	}
	category := strings.TrimSpace(query.Get("category"))
	page, pageSize := pagination(r)

	items, total, err := s.store.ListFiles(r.Context(), store.FileFilter{
		RootID:   rootID,
		Category: category,
		Query:    strings.TrimSpace(query.Get("q")),
		Sort:     strings.ToLower(query.Get("sort")),
		Order:    strings.ToLower(query.Get("order")),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		return internalError(err)
	}
	for i := range items {
		items[i].URL = fileContentURL(items[i].Code)
	}
	writeJSON(w, model.Page[model.FileEntry]{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
	return nil
}

func (s *Server) handleFileStats(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	stats, err := s.store.StorageStats(r.Context())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, stats)
	return nil
}

func (s *Server) handleDuplicates(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	rootID := strings.TrimSpace(r.URL.Query().Get("rootId"))
	if rootID != "" {
		if _, err := s.rootByID(r.Context(), rootID); err != nil {
			return err
		}
	}
	page, pageSize := pagination(r)
	groups, total, err := s.store.DuplicateGroups(r.Context(), rootID, page, pageSize)
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, model.Page[model.DuplicateGroup]{
		Items:    groups,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
	return nil
}

func (s *Server) handleReindex(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	var req struct {
		RootID string `json:"rootId"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}

	var roots []model.ResourceRoot
	if req.RootID != "" {
		root, err := s.store.RootByID(r.Context(), req.RootID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return notFound("资源根目录不存在")
			}
			return internalError(err)
		}
		roots = []model.ResourceRoot{*root}
	} else {
		var err error
		roots, err = s.store.ListRoots(r.Context())
		if err != nil {
			return internalError(err)
		}
	}

	ids := make([]string, 0, len(roots))
	for _, root := range roots {
		ids = append(ids, root.ID)
	}
	// 先取入队前的状态作为基线，再入队：调用方据此判断「本次扫描」是否已结束，
	// 避免秒级完成的根目录看起来像没执行。
	baseline := s.indexQueue.Snapshot(ids)
	queued := s.indexQueue.EnqueueAll(ids)
	// 语义改为「入队」：立即返回，实际扫描由单 worker 串行执行
	writeJSON(w, struct {
		Queued []string             `json:"queued"`
		Status []indexer.RootStatus `json:"status"`
	}{Queued: queued, Status: baseline})
	return nil
}
