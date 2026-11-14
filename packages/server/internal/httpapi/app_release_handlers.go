package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

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
