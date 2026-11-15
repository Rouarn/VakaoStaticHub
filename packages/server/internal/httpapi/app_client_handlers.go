package httpapi

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
	"vakao-static-hub/server/internal/store"
)

// handleCheckUpdate 实现客户端更新检查，并包含灰度分桶。
func (s *Server) handleCheckUpdate(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	appKey := pathValue(r, "appKey")
	query := r.URL.Query()
	platform := strings.ToLower(strings.TrimSpace(query.Get("platform")))
	if platform == "" {
		platform = defaultAppPlatform
	}
	currentVersion, err := parseInt64(query.Get("versionCode"), "versionCode")
	if err != nil || currentVersion < 0 {
		return validationFailed("版本号不能为空").WithField("versionCode", "无效")
	}
	deviceID := strings.TrimSpace(query.Get("deviceId"))

	versions, err := s.store.LatestPublished(r.Context(), appKey, platform)
	if err != nil {
		return internalError(err)
	}
	var selected *store.VersionRecord
	for i := range versions {
		candidate := versions[i]
		if candidate.VersionCode <= currentVersion {
			continue
		}
		if candidate.GrayPercent < 100 {
			if deviceID == "" || !inGrayBucket(deviceID, candidate.ID, candidate.GrayPercent) {
				continue
			}
		}
		selected = &candidate
		break
	}
	if selected == nil {
		writeJSON(w, model.UpdateInfo{Available: false})
		return nil
	}
	info := model.UpdateInfo{
		Available:      true,
		VersionID:      selected.ID,
		VersionName:    selected.VersionName,
		VersionCode:    selected.VersionCode,
		UpdateLog:      selected.UpdateLog,
		ForceUpdate:    selected.ForceUpdate || currentVersion < selected.MinVersionCode,
		MinVersionCode: selected.MinVersionCode,
		FileSize:       selected.FileSize,
		Checksum:       selected.Checksum,
		DownloadURL:    s.packageDownloadURL(selected.ID),
	}
	writeJSON(w, info)
	return nil
}

// handleDownloadPackage 流式下发安装包，只允许已发布或已下架版本；
// 响应带 Content-Disposition 与 X-Checksum-Sha256 供客户端校验。
func (s *Server) handleDownloadPackage(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	id, err := parseInt64(pathValue(r, "id"), "版本 id")
	if err != nil || id <= 0 {
		return badRequest("版本 id 无效")
	}
	record, err := s.store.VersionByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("版本不存在")
		}
		return internalError(err)
	}
	if record.Status != "published" && record.Status != "offline" {
		return gone("该安装包当前不可下载")
	}
	root, err := s.rootByID(r.Context(), record.StorageRootID)
	if err != nil {
		return err
	}
	full, err := storage.Join(filepath.Join(root.Path, record.Category), record.RelPath)
	if err != nil {
		return badRequest("安装包路径无效")
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return notFound("安装包文件不存在")
	}
	f, err := os.Open(full)
	if err != nil {
		return notFound("安装包文件不存在")
	}
	defer f.Close()
	w.Header().Set("Content-Disposition", contentDisposition(info.Name(), true))
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("X-Checksum-Sha256", record.Checksum)
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	return nil
}

// handleReportEvents 接收客户端升级埋点。事件类型是白名单，
// 未知类型直接拒绝；写入失败不影响客户端继续升级。
func (s *Server) handleReportEvents(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	var req model.ReportEventRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	req.AppKey = strings.TrimSpace(req.AppKey)
	req.DeviceID = strings.TrimSpace(req.DeviceID)
	req.Event = strings.ToLower(strings.TrimSpace(req.Event))
	if req.AppKey == "" {
		return validationFailed("appKey 不能为空").WithField("appKey", "不能为空")
	}
	if req.DeviceID == "" {
		return validationFailed("deviceId 不能为空").WithField("deviceId", "不能为空")
	}
	switch req.Event {
	case "check_no_update", "prompt_show", "download_start", "download_success", "download_fail",
		"verify_fail", "install_success", "install_fail", "new_version_launch":
	default:
		return validationFailed("不支持该事件类型").WithField("event", "未知事件类型")
	}
	if err := s.store.InsertUpgradeEvent(r.Context(), req, nil); err != nil {
		return internalError(err)
	}
	writeJSON(w, nil)
	return nil
}
