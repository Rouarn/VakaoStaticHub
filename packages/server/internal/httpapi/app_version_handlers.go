package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

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
