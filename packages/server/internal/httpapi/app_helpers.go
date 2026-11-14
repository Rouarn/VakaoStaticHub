package httpapi

import (
	"context"
	"errors"
	"hash/fnv"
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
