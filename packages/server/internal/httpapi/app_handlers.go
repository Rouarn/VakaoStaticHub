package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

const (
	defaultAppPlatform = "android"
	maxPackageSize     = 2 << 30 // 2 GiB 上限，防止上传失控
)

func (s *Server) handleListApps(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	apps, err := s.store.ListApps(r.Context())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, apps)
	return nil
}

func (s *Server) handleCreateApp(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.CreateAppRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	appKey := strings.TrimSpace(req.AppKey)
	if appKey == "" || len(appKey) > 64 {
		return validationFailed("appKey 不能为空").WithField("appKey", "appKey 无效")
	}
	platform := strings.ToLower(strings.TrimSpace(req.Platform))
	if platform == "" {
		platform = defaultAppPlatform
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = appKey
	}
	app, err := s.store.CreateApp(r.Context(), model.App{AppKey: appKey, Platform: platform, Name: name})
	if err != nil {
		if isUniqueErr(err) {
			return conflict("该平台下已存在同名应用")
		}
		return internalError(err)
	}
	s.audit(r, user, "app.create", "app", appKey, map[string]any{"platform": platform})
	writeJSON(w, app)
	return nil
}

func (s *Server) handleUpdateApp(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.UpdateAppRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	appKey := pathValue(r, "appKey")
	platform := appPlatform(r)
	if req.AppKey == nil && req.Name == nil {
		return validationFailed("名称和 appKey 至少填写一项").WithField("name", "至少填写一项")
	}
	nextKey := appKey
	if req.AppKey != nil {
		candidate := strings.TrimSpace(*req.AppKey)
		if candidate == "" || len(candidate) > 64 {
			return validationFailed("appKey 无效").WithField("appKey", "appKey 无效")
		}
		if candidate != appKey {
			if err := s.store.RenameApp(r.Context(), appKey, platform, candidate); err != nil {
				if errors.Is(err, store.ErrNotFound) {
					return notFound("应用不存在")
				}
				if isUniqueErr(err) {
					return conflict("该平台下已存在同名应用")
				}
				return internalError(err)
			}
			nextKey = candidate
		}
	}
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return validationFailed("名称不能为空").WithField("name", "名称不能为空")
		}
		if err := s.store.UpdateAppName(r.Context(), nextKey, platform, name); err != nil {
			return internalError(err)
		}
	}
	app, err := s.store.AppByKey(r.Context(), nextKey, platform)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "app.rename", "app", nextKey, map[string]any{"previousKey": appKey})
	writeJSON(w, app.App)
	return nil
}

func (s *Server) handleDeleteApp(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	appKey := pathValue(r, "appKey")
	platform := appPlatform(r)
	if _, err := s.store.AppByKey(r.Context(), appKey, platform); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("应用不存在")
		}
		return internalError(err)
	}
	versions, _, err := s.store.ListVersions(r.Context(), store.VersionFilter{AppKey: appKey, Platform: platform, Page: 1, PageSize: 500})
	if err != nil {
		return internalError(err)
	}
	eventCount, err := s.store.CountUpgradeEventsByApp(r.Context(), appKey)
	if err != nil {
		return internalError(err)
	}
	if err := s.store.DeleteApp(r.Context(), appKey, platform); err != nil {
		return internalError(err)
	}
	// 尽力而为：记录已删除，残留的安装包只会浪费磁盘。
	for _, version := range versions {
		s.removeVersionFile(r.Context(), version.AppVersion)
	}
	s.audit(r, user, "app.delete", "app", appKey, map[string]any{"platform": platform, "versions": len(versions)})
	writeJSON(w, model.AppDeleteResult{VersionCount: len(versions), EventCount: eventCount})
	return nil
}
