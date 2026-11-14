package httpapi

import (
	"net/http"
	"os"
	"runtime"
	"sync"
	"time"

	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
	"vakao-static-hub/server/internal/sysinfo"
)

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	ctx := r.Context()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	files, totalSize, err := s.store.StorageTotals(ctx)
	if err != nil {
		return internalError(err)
	}
	users, _ := s.store.CountUsers(ctx)
	shares, _ := s.store.CountShares(ctx)
	versions, _ := s.store.CountVersions(ctx)
	events, _ := s.store.CountUpgradeEvents(ctx)
	audits, _ := s.store.CountAudit(ctx)
	roots, _ := s.store.RootMetrics(ctx)
	shareCounts, _ := s.store.ShareStatusCounts(ctx, store.NowMS())
	versionCounts, _ := s.store.VersionStatusMetrics(ctx)
	events24h, _ := s.store.UpgradeEventCounts(ctx, time.Now().Add(-24*time.Hour).UnixMilli())

	writeJSON(w, model.Metrics{
		Version:       s.version,
		UptimeSeconds: int64(time.Since(s.started).Seconds()),
		GoVersion:     runtime.Version(),
		Memory: model.MemoryMetrics{
			RSS:       sysinfo.RSS(),
			HeapAlloc: mem.HeapAlloc,
			HeapSys:   mem.HeapSys,
			Sys:       mem.Sys,
			NumGC:     mem.NumGC,
		},
		QPS: s.qps.value(),
		Database: model.DatabaseMetrics{
			Path:    s.cfg.DBPath,
			Size:    fileSize(s.cfg.DBPath),
			WALSize: fileSize(s.cfg.DBPath + "-wal"),
		},
		Storage: model.StorageMetrics{
			FileRoot:  s.cfg.FileRoot,
			FileCount: files,
			TotalSize: totalSize,
		},
		Counts: model.CountMetrics{
			Users:         users,
			Files:         files,
			Shares:        shares,
			AppVersions:   versions,
			UpgradeEvents: events,
			AuditLogs:     audits,
		},
		Roots:            roots,
		Shares:           model.ShareStatusMetric{Total: shareCounts.All, Active: shareCounts.Active, Expired: shareCounts.Expired},
		Apps:             versionCounts,
		UpgradeEvents24h: events24h,
	})
	return nil
}

func (s *Server) handleMetricsSidebar(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	ctx := r.Context()
	files, totalSize, err := s.store.StorageTotals(ctx)
	if err != nil {
		return internalError(err)
	}
	shares, _ := s.store.CountShares(ctx)
	users, _ := s.store.CountUsers(ctx)
	versions, _ := s.store.CountVersions(ctx)
	writeJSON(w, model.SidebarMetrics{
		Files: files, Shares: shares, Users: users, AppVersions: versions, TotalSize: totalSize,
	})
	return nil
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

// qpsMeter 维护最近一分钟内已处理请求的滑动计数。
type qpsMeter struct {
	mu      sync.Mutex
	buckets [60]int64
	second  int64
}

func (m *qpsMeter) hit() {
	now := time.Now().Unix()
	m.mu.Lock()
	defer m.mu.Unlock()
	if now != m.second {
		gap := now - m.second
		if gap >= int64(len(m.buckets)) {
			m.buckets = [60]int64{}
		} else {
			for i := int64(1); i <= gap; i++ {
				m.buckets[(m.second+i)%int64(len(m.buckets))] = 0
			}
		}
		m.second = now
	}
	m.buckets[now%int64(len(m.buckets))]++
}

func (m *qpsMeter) value() float64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var total int64
	for _, count := range m.buckets {
		total += count
	}
	return float64(total) / float64(len(m.buckets))
}
