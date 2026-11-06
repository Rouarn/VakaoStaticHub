package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash/fnv"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/storage"
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

func (s *Server) handleListVersions(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	appKey := pathValue(r, "appKey")
	page, pageSize := pagination(r)
	records, total, err := s.store.ListVersions(r.Context(), store.VersionFilter{
		AppKey:   appKey,
		Platform: strings.ToLower(strings.TrimSpace(r.URL.Query().Get("platform"))),
		Status:   strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status"))),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		return internalError(err)
	}
	items := make([]model.AppVersion, 0, len(records))
	for _, record := range records {
		items = append(items, s.versionView(record))
	}
	writeJSON(w, model.Page[model.AppVersion]{
		Items: items, Total: total, Page: page, PageSize: pageSize,
	})
	return nil
}

// handleCreateVersion 接收包含元数据字段和一个安装包的
// multipart 表单。文件边写入磁盘边计算校验和。
func (s *Server) handleCreateVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	appKey := pathValue(r, "appKey")
	reader, err := r.MultipartReader()
	if err != nil {
		return unsupportedMedia("Content-Type 必须为 multipart/form-data")
	}

	fields := make(map[string]string, 12)
	var (
		tmpPath   string
		savedSize int64
		savedName string
		savedHash string
	)
	defer func() {
		if tmpPath != "" {
			_ = os.Remove(tmpPath)
		}
	}()

	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return badRequest("multipart 请求体格式错误")
		}
		if part.FileName() == "" {
			value, readErr := io.ReadAll(io.LimitReader(part, 8<<10))
			_ = part.Close()
			if readErr != nil {
				return badRequest("无法读取表单字段")
			}
			fields[part.FormName()] = string(value)
			continue
		}
		if tmpPath != "" {
			_ = part.Close()
			return badRequest("只能上传一个安装包文件")
		}
		path, size, name, hash, saveErr := s.savePackageTemp(part)
		_ = part.Close()
		if saveErr != nil {
			return saveErr
		}
		tmpPath, savedSize, savedName, savedHash = path, size, name, hash
	}

	if tmpPath == "" {
		return badRequest("请选择安装包文件")
	}
	platform := strings.ToLower(strings.TrimSpace(fields["platform"]))
	if platform == "" {
		platform = defaultAppPlatform
	}
	app, err := s.store.AppByKey(r.Context(), appKey, platform)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("应用不存在，请先创建应用")
		}
		return internalError(err)
	}
	versionName := strings.TrimSpace(fields["versionName"])
	if versionName == "" || len(versionName) > 32 {
		return validationFailed("版本名不能为空").WithField("versionName", "版本名无效")
	}
	versionCode, err := parseInt64(fields["versionCode"], "versionCode")
	if err != nil || versionCode <= 0 {
		return validationFailed("版本号不能为空").WithField("versionCode", "必须为正整数")
	}
	minVersionCode := int64(0)
	if raw := strings.TrimSpace(fields["minVersionCode"]); raw != "" {
		minVersionCode, err = parseInt64(raw, "minVersionCode")
		if err != nil || minVersionCode < 0 {
			return validationFailed("最低版本号无效").WithField("minVersionCode", "必须大于等于 0")
		}
	}

	root, err := s.resolvePackageRoot(r.Context(), fields["storageRootId"])
	if err != nil {
		return err
	}
	category := strings.TrimSpace(fields["category"])
	if category == "" {
		category = appKey
	}
	category, err = validateCategoryName(category)
	if err != nil {
		return err
	}
	categoryDir := filepath.Join(root.Path, category)
	if err := os.MkdirAll(categoryDir, 0o755); err != nil {
		return internalError(err)
	}
	finalName := availableName(categoryDir, savedName)
	finalPath := filepath.Join(categoryDir, finalName)
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return internalError(err)
	}
	tmpPath = ""
	savedName = finalName

	forceUpdate := strings.EqualFold(strings.TrimSpace(fields["forceUpdate"]), "true") || strings.TrimSpace(fields["forceUpdate"]) == "1"
	record, err := s.store.CreateVersion(r.Context(), store.VersionRecord{
		AppID: app.ID,
		AppVersion: model.AppVersion{
			AppKey:         appKey,
			Platform:       platform,
			VersionName:    versionName,
			VersionCode:    versionCode,
			FileSize:       savedSize,
			Checksum:       savedHash,
			StorageRootID:  root.ID,
			Category:       category,
			RelPath:        savedName,
			UpdateLog:      fields["updateLog"],
			Remark:         fields["remark"],
			ForceUpdate:    forceUpdate,
			MinVersionCode: minVersionCode,
			Status:         "draft",
		},
	})
	if err != nil {
		_ = os.Remove(finalPath)
		if isUniqueErr(err) {
			return conflict("该应用的版本号已存在")
		}
		return internalError(err)
	}
	if raw := strings.TrimSpace(fields["scheduledPublishAt"]); raw != "" && raw != "null" {
		publishAt, err := parseInt64(raw, "scheduledPublishAt")
		if err != nil {
			return validationFailed("定时发布时间无效").WithField("scheduledPublishAt", "时间格式无效")
		}
		if publishAt > time.Now().UnixMilli() {
			mode := strings.ToLower(strings.TrimSpace(fields["scheduledPublishMode"]))
			if mode != "gray" {
				mode = "full"
			}
			grayPercent := 100
			if rawGray := strings.TrimSpace(fields["scheduledGrayPercent"]); rawGray != "" {
				parsed, err := parseInt64(rawGray, "scheduledGrayPercent")
				if err != nil || parsed < 1 || parsed > 99 {
					return validationFailed("定时灰度比例无效").WithField("scheduledGrayPercent", "超出范围")
				}
				grayPercent = int(parsed)
			}
			if err := s.store.SchedulePublish(r.Context(), record.ID, publishAt, mode, grayPercent); err != nil {
				return internalError(err)
			}
			if record, err = s.store.VersionByID(r.Context(), record.ID); err != nil {
				return internalError(err)
			}
		}
	}
	if _, err := s.store.UpsertFile(r.Context(), model.FileEntry{
		RootID:      root.ID,
		Category:    category,
		RelPath:     savedName,
		Name:        savedName,
		Extension:   strings.TrimPrefix(strings.ToLower(filepath.Ext(savedName)), "."),
		Size:        savedSize,
		MTime:       time.Now(),
		ContentHash: savedHash,
	}); err != nil {
		s.log.Error("index app package failed", "error", err, "path", finalPath)
	}
	s.audit(r, user, "app_version.create", "app_version", strconv.FormatInt(record.ID, 10), map[string]any{
		"appKey": appKey, "platform": platform, "versionName": versionName, "versionCode": versionCode,
	})
	writeJSON(w, s.versionView(record))
	return nil
}

// savePackageTemp 将上传的安装包流式写入上传临时目录，
// 并返回临时路径、大小、原始文件名与 SHA-256。先完整解析
// multipart 请求体，因此字段在报文中的顺序无关紧要。
func (s *Server) savePackageTemp(part *multipart.Part) (string, int64, string, string, error) {
	dir := s.cfg.UploadTempDir
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, "", "", internalError(err)
	}
	name := safeUploadName(part.FileName())
	if name == "" {
		name = "package.bin"
	}
	tmp, err := os.CreateTemp(dir, ".package-*")
	if err != nil {
		return "", 0, "", "", internalError(err)
	}
	hasher := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(tmp, hasher), io.LimitReader(part, maxPackageSize+1))
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmp.Name())
		return "", 0, "", "", badRequest("无法写入安装包文件")
	}
	if size > maxPackageSize {
		_ = os.Remove(tmp.Name())
		return "", 0, "", "", payloadTooLarge("安装包超过 2 GiB 限制")
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		_ = os.Remove(tmp.Name())
		return "", 0, "", "", internalError(err)
	}
	return tmp.Name(), size, name, hex.EncodeToString(hasher.Sum(nil)), nil
}

// resolvePackageRoot 选择存放 APP 安装包的资源根目录。显式指定的
// 字段优先；否则使用约定的「software-update」根目录，
// 仅有一个根目录的部署则回退到该唯一根目录。
func (s *Server) resolvePackageRoot(ctx context.Context, requested string) (*model.ResourceRoot, error) {
	if id := strings.TrimSpace(requested); id != "" {
		return s.rootByID(ctx, id)
	}
	if root, err := s.store.RootByID(ctx, "software-update"); err == nil {
		return root, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, internalError(err)
	}
	roots, err := s.store.ListRoots(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	if len(roots) == 0 {
		return nil, conflict("请先创建资源根目录再上传安装包")
	}
	return &roots[0], nil
}

func (s *Server) handleVersionDetail(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	writeJSON(w, s.versionView(record))
	return nil
}

func (s *Server) handleUpdateVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	var req model.UpdateVersionRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	if req.GrayPercent != nil && (*req.GrayPercent < 0 || *req.GrayPercent > 100) {
		return validationFailed("灰度比例需在 0 到 100 之间").WithField("grayPercent", "超出范围")
	}
	for _, step := range req.GrayIncrementSchedule {
		if step.Percent < 0 || step.Percent > 100 || step.AfterMinutes < 0 {
			return validationFailed("灰度递增计划无效").WithField("grayIncrementSchedule", "递增步骤无效")
		}
	}
	if req.VersionName != nil {
		name := strings.TrimSpace(*req.VersionName)
		if name == "" || len(name) > 32 {
			return validationFailed("版本名无效").WithField("versionName", "版本名无效")
		}
		req.VersionName = &name
	}
	update := store.VersionUpdate{
		VersionName:       req.VersionName,
		UpdateLog:         req.UpdateLog,
		Remark:            req.Remark,
		ForceUpdate:       req.ForceUpdate,
		MinVersionCode:    req.MinVersionCode,
		GrayPercent:       req.GrayPercent,
		GrayAutoIncrement: req.GrayAutoIncrement,
	}
	if req.GrayIncrementSchedule != nil {
		update.Schedule = &req.GrayIncrementSchedule
	}
	if req.ScheduledPublishAt != nil && req.ScheduledPublishAt.Set {
		value := int64(0)
		if req.ScheduledPublishAt.Value != nil {
			value = *req.ScheduledPublishAt.Value
		}
		update.ScheduledAt = &value
	}
	if req.ScheduledPublishMode != nil {
		mode := strings.ToLower(strings.TrimSpace(*req.ScheduledPublishMode))
		if mode != "gray" {
			mode = "full"
		}
		update.ScheduledMode = &mode
	}
	if req.ScheduledGrayPercent != nil {
		update.ScheduledGrayPercent = req.ScheduledGrayPercent
	}
	if err := s.store.UpdateVersion(r.Context(), record.ID, update); err != nil {
		return internalError(err)
	}
	updated, err := s.store.VersionByID(r.Context(), record.ID)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "app_version.update", "app_version", strconv.FormatInt(record.ID, 10), nil)
	writeJSON(w, s.versionView(updated))
	return nil
}

func (s *Server) handleDeleteVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	if record.Status == "published" {
		return conflict("请先下架该版本再删除")
	}
	if err := s.store.DeleteVersion(r.Context(), record.ID); err != nil {
		return internalError(err)
	}
	s.removeVersionFile(r.Context(), record.AppVersion)
	s.audit(r, user, "app_version.delete", "app_version", strconv.FormatInt(record.ID, 10), map[string]any{
		"appKey": record.AppKey, "versionCode": record.VersionCode,
	})
	writeJSON(w, nil)
	return nil
}

func (s *Server) handlePublishVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	var req model.PublishRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "full"
	}
	switch mode {
	case "full":
		if err := s.store.PublishVersion(r.Context(), record.ID, 100, time.Now().UnixMilli()); err != nil {
			return internalError(err)
		}
	case "gray":
		if req.GrayPercent <= 0 || req.GrayPercent >= 100 {
			return validationFailed("灰度比例需在 1 到 99 之间").WithField("grayPercent", "超出范围")
		}
		if err := s.store.PublishVersion(r.Context(), record.ID, req.GrayPercent, time.Now().UnixMilli()); err != nil {
			return internalError(err)
		}
		update := store.VersionUpdate{GrayAutoIncrement: &req.GrayAutoIncrement}
		if len(req.GrayIncrementSchedule) > 0 {
			steps := make([]model.GrayStep, 0, len(req.GrayIncrementSchedule))
			for _, step := range req.GrayIncrementSchedule {
				steps = append(steps, model.GrayStep{AfterMinutes: step.Hours * 60, Percent: step.Percent})
			}
			update.Schedule = &steps
		}
		if err := s.store.UpdateVersion(r.Context(), record.ID, update); err != nil {
			return internalError(err)
		}
	case "scheduled":
		publishAt, err := parseFutureTime(req.PublishAt)
		if err != nil {
			return err
		}
		scheduledMode := "full"
		if req.GrayPercent > 0 && req.GrayPercent < 100 {
			scheduledMode = "gray"
		}
		if err := s.store.SchedulePublish(r.Context(), record.ID, publishAt.UnixMilli(), scheduledMode, req.GrayPercent); err != nil {
			return internalError(err)
		}
	default:
		return validationFailed("mode 只能为 full、gray 或 scheduled").WithField("mode", "模式无效")
	}
	updated, err := s.store.VersionByID(r.Context(), record.ID)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "app_version.publish", "app_version", strconv.FormatInt(record.ID, 10), map[string]any{
		"mode": mode, "grayPercent": req.GrayPercent,
	})
	writeJSON(w, s.versionView(updated))
	return nil
}

func (s *Server) handleOfflineVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	var req model.OfflineRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	if record.Status != "published" {
		return conflict("仅已发布版本可以下架")
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "manual offline"
	}
	if err := s.store.SetVersionStatus(r.Context(), record.ID, "offline", truncateText(reason, 255)); err != nil {
		return internalError(err)
	}
	updated, err := s.store.VersionByID(r.Context(), record.ID)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "app_version.offline", "app_version", strconv.FormatInt(record.ID, 10), map[string]any{"reason": reason})
	writeJSON(w, s.versionView(updated))
	return nil
}

func (s *Server) handleForceVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	var req model.ForceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	if req.MinVersionCode < 0 {
		return validationFailed("最低版本号必须大于等于 0").WithField("minVersionCode", "无效")
	}
	force := req.ForceUpdate
	minVersion := req.MinVersionCode
	if err := s.store.UpdateVersion(r.Context(), record.ID, store.VersionUpdate{
		ForceUpdate: &force, MinVersionCode: &minVersion,
	}); err != nil {
		return internalError(err)
	}
	updated, err := s.store.VersionByID(r.Context(), record.ID)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "app_version.force_update", "app_version", strconv.FormatInt(record.ID, 10), map[string]any{
		"forceUpdate": force, "minVersionCode": minVersion,
	})
	writeJSON(w, s.versionView(updated))
	return nil
}

// handleRollbackVersion 恢复较旧的构建。路径中的 id 是操作者
// 发起回滚时所处的版本（通常是当前发布版本）；请求体可通过
// toVersionId 指定候选版本，否则恢复最新的合格旧
// 版本。响应为被恢复的版本。
func (s *Server) handleRollbackVersion(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	var req model.RollbackRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	var target store.VersionRecord
	if req.ToVersionID > 0 {
		target, err = s.store.VersionByID(r.Context(), req.ToVersionID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return notFound("目标版本不存在")
			}
			return internalError(err)
		}
		if target.AppID != record.AppID {
			return badRequest("目标版本属于其他应用")
		}
		if target.VersionCode >= record.VersionCode {
			return badRequest("目标版本必须早于当前版本")
		}
	} else {
		candidates, err := s.store.RollbackCandidates(r.Context(), record.AppID, record.VersionCode)
		if err != nil {
			return internalError(err)
		}
		if len(candidates) == 0 {
			return badRequest("没有可回滚的更早版本")
		}
		target = candidates[0]
	}
	if err := s.store.PublishVersion(r.Context(), target.ID, 100, time.Now().UnixMilli()); err != nil {
		return internalError(err)
	}
	if record.Status == "published" || record.Status == "gray" {
		if err := s.store.SetVersionStatus(r.Context(), record.ID, "offline", "rolled back"); err != nil {
			s.log.Error("mark rolled back version offline failed", "error", err, "id", record.ID)
		}
	}
	updated, err := s.store.VersionByID(r.Context(), target.ID)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, user, "app_version.rollback", "app_version", strconv.FormatInt(record.ID, 10), map[string]any{
		"fromVersionId": record.ID, "toVersionId": target.ID, "toVersionCode": target.VersionCode,
	})
	writeJSON(w, s.versionView(updated))
	return nil
}

func (s *Server) handleRollbackCandidates(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	record, err := s.versionByID(r)
	if err != nil {
		return err
	}
	candidates, err := s.store.RollbackCandidates(r.Context(), record.AppID, record.VersionCode)
	if err != nil {
		return internalError(err)
	}
	items := make([]model.AppVersion, 0, len(candidates))
	for _, candidate := range candidates {
		items = append(items, s.versionView(candidate))
	}
	writeJSON(w, model.RollbackCandidatesResponse{Candidates: items})
	return nil
}

func (s *Server) handleAppFunnel(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	appKey := pathValue(r, "appKey")
	query := r.URL.Query()
	end := time.Now()
	start := end.AddDate(0, 0, -30)
	if raw := strings.TrimSpace(query.Get("startTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("startTime 需为 RFC 3339 时间格式").WithField("startTime", "时间格式无效")
		}
		start = parsed
	}
	if raw := strings.TrimSpace(query.Get("endTime")); raw != "" {
		parsed, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			return validationFailed("endTime 需为 RFC 3339 时间格式").WithField("endTime", "时间格式无效")
		}
		end = parsed
	}
	result, err := s.store.Funnel(r.Context(), appKey, start.UnixMilli(), end.UnixMilli())
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, result)
	return nil
}

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

func (s *Server) versionByID(r *http.Request) (store.VersionRecord, error) {
	id, err := parseInt64(pathValue(r, "id"), "版本 id")
	if err != nil || id <= 0 {
		return store.VersionRecord{}, badRequest("版本 id 无效")
	}
	record, err := s.store.VersionByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return store.VersionRecord{}, notFound("版本不存在")
		}
		return store.VersionRecord{}, internalError(err)
	}
	return record, nil
}

func (s *Server) versionView(record store.VersionRecord) model.AppVersion {
	version := record.AppVersion
	version.DownloadURL = s.packageDownloadURL(record.ID)
	return version
}

func (s *Server) packageDownloadURL(id int64) string {
	path := "/v1/a/versions/" + strconv.FormatInt(id, 10) + "/download"
	if s.cfg.AppPublicBase != "" {
		return s.cfg.AppPublicBase + path
	}
	return path
}

// removeVersionFile 删除安装包及其索引记录；失败只会
// 记录日志，因为数据库记录此时已删除。
func (s *Server) removeVersionFile(ctx context.Context, record model.AppVersion) {
	root, err := s.store.RootByID(ctx, record.StorageRootID)
	if err != nil {
		return
	}
	full, err := storage.Join(filepath.Join(root.Path, record.Category), record.RelPath)
	if err != nil {
		return
	}
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		s.log.Warn("remove package file failed", "error", err, "path", full)
	}
	_ = s.store.DeleteFileEntry(ctx, root.ID, record.Category, record.RelPath)
}

func inGrayBucket(deviceID string, versionID int64, percent int) bool {
	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(deviceID + ":" + strconv.FormatInt(versionID, 10)))
	return int(hasher.Sum32()%100) < percent
}

func parseFutureTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, validationFailed("发布时间不能为空").WithField("publishAt", "不能为空")
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}, validationFailed("发布时间需为 RFC 3339 时间格式").WithField("publishAt", "时间格式无效")
	}
	if !parsed.After(time.Now()) {
		return time.Time{}, validationFailed("发布时间必须晚于当前时间").WithField("publishAt", "必须晚于当前时间")
	}
	return parsed, nil
}

func appPlatform(r *http.Request) string {
	platform := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("platform")))
	if platform == "" {
		return defaultAppPlatform
	}
	return platform
}

func truncateText(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func isUniqueErr(err error) bool {
	return err != nil && strings.Contains(strings.ToUpper(err.Error()), "UNIQUE")
}
