package model

import (
	"encoding/json"
	"time"
)

type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ResourceRoot struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	Description string    `json:"description,omitempty"`
	SortOrder   int       `json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type FileEntry struct {
	ID          int64     `json:"id"`
	RootID      string    `json:"rootId"`
	Category    string    `json:"category"`
	RelPath     string    `json:"relPath"`
	Name        string    `json:"name"`
	Extension   string    `json:"extension"`
	Size        int64     `json:"size"`
	MTime       time.Time `json:"mtime"`
	ContentHash string    `json:"contentHash,omitempty"`
	URL         string    `json:"url"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type CategoryInfo struct {
	Name      string `json:"name"`
	FileCount int    `json:"fileCount"`
	TotalSize int64  `json:"totalSize"`
}

type StorageStat struct {
	RootID    string `json:"rootId"`
	RootName  string `json:"rootName"`
	Category  string `json:"category"`
	FileCount int    `json:"fileCount"`
	TotalSize int64  `json:"totalSize"`
}

type DuplicateFile struct {
	ID       int64     `json:"id"`
	RootID   string    `json:"rootId"`
	Category string    `json:"category"`
	RelPath  string    `json:"relPath"`
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	MTime    time.Time `json:"mtime"`
}

type DuplicateGroup struct {
	Hash  string          `json:"hash"`
	Size  int64           `json:"size"`
	Count int             `json:"count"`
	Files []DuplicateFile `json:"files"`
}

type FileConfig struct {
	MaxUploadCount    int    `json:"maxUploadCount"`
	ChunkSizeLimit    int64  `json:"chunkSizeLimit"`
	DefaultCategory   string `json:"defaultCategory"`
	MaxImagePixels    int64  `json:"maxImagePixels"`
	MaxImageDimension int    `json:"maxImageDimension"`
	CacheRefreshMS    int64  `json:"cacheRefreshMs"`
}

type Page[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

// Envelope 统一了所有 JSON 响应与错误的外层结构。
// 成功时 Code 为 200、Message 为 ok；失败时 Code 为 HTTP 状态码、Data 为 null。
type Envelope struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
}

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token     string    `json:"token"`
	TokenType string    `json:"tokenType"`
	ExpiresAt time.Time `json:"expiresAt"`
	User      User      `json:"user"`
}

type CreateUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

type ResetPasswordRequest struct {
	Password string `json:"password"`
}

type CreateRootRequest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description"`
}

type UpdateRootRequest struct {
	Name        *string `json:"name"`
	Path        *string `json:"path"`
	Description *string `json:"description"`
}

type CreateCategoryRequest struct {
	RootID string `json:"rootId"`
	Name   string `json:"name"`
}

type RenameCategoryRequest struct {
	RootID  string `json:"rootId"`
	Name    string `json:"name"`
	NewName string `json:"newName"`
}

type RenameFileRequest struct {
	RootID   string `json:"rootId"`
	Category string `json:"category"`
	Path     string `json:"path"`
	NewName  string `json:"newName"`
}

type BatchDeleteRequest struct {
	RootID   string   `json:"rootId"`
	Category string   `json:"category"`
	Paths    []string `json:"paths"`
}

type BatchMoveRequest struct {
	RootID         string   `json:"rootId"`
	Category       string   `json:"category"`
	Paths          []string `json:"paths"`
	TargetCategory string   `json:"targetCategory"`
}

type ChunkInitRequest struct {
	RootID    string `json:"rootId"`
	Category  string `json:"category"`
	Filename  string `json:"filename"`
	Size      int64  `json:"size"`
	ChunkSize int64  `json:"chunkSize"`
}

type ChunkInitResponse struct {
	UploadID       string `json:"uploadId"`
	ChunkSize      int64  `json:"chunkSize"`
	UploadedChunks []int  `json:"uploadedChunks"`
}

type ChunkCompleteRequest struct {
	UploadID string `json:"uploadId"`
	RootID   string `json:"rootId"`
	Category string `json:"category"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

type ShareLink struct {
	ID          int64      `json:"id"`
	Token       string     `json:"token"`
	RootID      string     `json:"rootId"`
	Category    string     `json:"category"`
	FilePaths   []string   `json:"filePaths"`
	Remark      string     `json:"remark,omitempty"`
	Enabled     bool       `json:"enabled"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	MaxAccesses *int       `json:"maxAccesses,omitempty"`
	Password    bool       `json:"password"`
	AccessCount int        `json:"accessCount"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
}

type CreateShareRequest struct {
	RootID      string   `json:"rootId"`
	Category    string   `json:"category"`
	FilePaths   []string `json:"filePaths"`
	Remark      string   `json:"remark"`
	Enabled     *bool    `json:"enabled"`
	ExpiresAt   *string  `json:"expiresAt"`
	MaxAccesses *int     `json:"maxAccesses"`
	Password    string   `json:"password"`
}

type UpdateShareRequest struct {
	Remark      *string `json:"remark"`
	Enabled     *bool   `json:"enabled"`
	ExpiresAt   *string `json:"expiresAt"`
	MaxAccesses *int    `json:"maxAccesses"`
	Password    *string `json:"password"`
}

type ShareInfo struct {
	Token       string     `json:"token"`
	Remark      string     `json:"remark,omitempty"`
	RootID      string     `json:"rootId"`
	Category    string     `json:"category"`
	FilePaths   []string   `json:"filePaths"`
	HasPassword bool       `json:"hasPassword"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	MaxAccesses *int       `json:"maxAccesses,omitempty"`
	AccessCount int        `json:"accessCount"`
	Enabled     bool       `json:"enabled"`
}

type ShareVerifyRequest struct {
	Password string `json:"password"`
}

type ShareVerifyResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// ShareCounts 是分享链接按互斥状态的统计明细。
type ShareCounts struct {
	All       int `json:"all"`
	Active    int `json:"active"`
	Expired   int `json:"expired"`
	Exhausted int `json:"exhausted"`
	Disabled  int `json:"disabled"`
}

// ShareListResponse 是一页分享链接，外加不受当前页影响的
// 状态计数。
type ShareListResponse struct {
	Items    []ShareLink `json:"items"`
	Total    int         `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"pageSize"`
	Counts   ShareCounts `json:"counts"`
}

type ShareAccessLog struct {
	ID        int64     `json:"id"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"userAgent"`
	Success   bool      `json:"success"`
	CreatedAt time.Time `json:"createdAt"`
}

type App struct {
	AppKey    string    `json:"appKey"`
	Name      string    `json:"name"`
	Platform  string    `json:"platform"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type AppVersion struct {
	ID                    int64      `json:"id"`
	Platform              string     `json:"platform"`
	AppKey                string     `json:"appKey"`
	VersionName           string     `json:"versionName"`
	VersionCode           int64      `json:"versionCode"`
	FileSize              int64      `json:"fileSize"`
	Checksum              string     `json:"checksum"`
	StorageRootID         string     `json:"storageRootId"`
	Category              string     `json:"category"`
	RelPath               string     `json:"relPath"`
	UpdateLog             string     `json:"updateLog,omitempty"`
	ForceUpdate           bool       `json:"forceUpdate"`
	MinVersionCode        int64      `json:"minVersionCode"`
	GrayPercent           int        `json:"grayPercent"`
	GrayAutoIncrement     bool       `json:"grayAutoIncrement"`
	GrayIncrementSchedule []GrayStep `json:"grayIncrementSchedule,omitempty"`
	ScheduledPublishAt    *time.Time `json:"scheduledPublishAt,omitempty"`
	ScheduledPublishMode  string     `json:"scheduledPublishMode,omitempty"`
	ScheduledGrayPercent  int        `json:"scheduledGrayPercent,omitempty"`
	Status                string     `json:"status"`
	OfflineReason         string     `json:"offlineReason,omitempty"`
	PublishTime           *time.Time `json:"publishTime,omitempty"`
	Remark                string     `json:"remark,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
	DownloadURL           string     `json:"downloadUrl,omitempty"`
}

type GrayStep struct {
	AfterMinutes int `json:"afterMinutes"`
	Percent      int `json:"percent"`
}

type CreateVersionRequest struct {
	Platform       string `json:"platform"`
	AppKey         string `json:"appKey"`
	VersionName    string `json:"versionName"`
	VersionCode    int64  `json:"versionCode"`
	UpdateLog      string `json:"updateLog"`
	Remark         string `json:"remark"`
	ForceUpdate    bool   `json:"forceUpdate"`
	MinVersionCode int64  `json:"minVersionCode"`
}

type UpdateVersionRequest struct {
	VersionName           *string        `json:"versionName"`
	UpdateLog             *string        `json:"updateLog"`
	Remark                *string        `json:"remark"`
	ForceUpdate           *bool          `json:"forceUpdate"`
	MinVersionCode        *int64         `json:"minVersionCode"`
	GrayPercent           *int           `json:"grayPercent"`
	GrayAutoIncrement     *bool          `json:"grayAutoIncrement"`
	GrayIncrementSchedule []GrayStep     `json:"grayIncrementSchedule"`
	ScheduledPublishAt    *NullableInt64 `json:"scheduledPublishAt"`
	ScheduledPublishMode  *string        `json:"scheduledPublishMode"`
	ScheduledGrayPercent  *int           `json:"scheduledGrayPercent"`
}

// NullableInt64 用于区分 JSON 字段缺失与显式 null。
type NullableInt64 struct {
	Set   bool
	Value *int64
}

func (n *NullableInt64) UnmarshalJSON(data []byte) error {
	n.Set = true
	if string(data) == "null" {
		n.Value = nil
		return nil
	}
	var value int64
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	n.Value = &value
	return nil
}

type PublishRequest struct {
	Mode                  string        `json:"mode"`
	GrayPercent           int           `json:"grayPercent"`
	PublishAt             string        `json:"publishAt,omitempty"`
	GrayAutoIncrement     bool          `json:"grayAutoIncrement"`
	GrayIncrementSchedule []PublishStep `json:"grayIncrementSchedule"`
}

// PublishStep 是以小时表示的灰度步骤，与客户端
// 契约一致。入库时会转换为分钟。
type PublishStep struct {
	Hours   int `json:"hours"`
	Percent int `json:"percent"`
}

type ForceRequest struct {
	ForceUpdate    bool  `json:"forceUpdate"`
	MinVersionCode int64 `json:"minVersionCode"`
}

type OfflineRequest struct {
	Reason string `json:"reason"`
}

type RollbackRequest struct {
	ToVersionID int64 `json:"toVersionId"`
}

type CheckUpdateRequest struct {
	AppKey      string `json:"appKey"`
	VersionCode int64  `json:"versionCode"`
	DeviceID    string `json:"deviceId"`
	Platform    string `json:"platform"`
}

type UpdateInfo struct {
	Available      bool   `json:"available"`
	VersionID      int64  `json:"versionId,omitempty"`
	VersionName    string `json:"versionName,omitempty"`
	VersionCode    int64  `json:"versionCode,omitempty"`
	UpdateLog      string `json:"updateLog,omitempty"`
	ForceUpdate    bool   `json:"forceUpdate"`
	MinVersionCode int64  `json:"minVersionCode,omitempty"`
	FileSize       int64  `json:"fileSize,omitempty"`
	Checksum       string `json:"checksum,omitempty"`
	DownloadURL    string `json:"downloadUrl,omitempty"`
}

type ReportEventRequest struct {
	AppKey          string `json:"appKey"`
	DeviceID        string `json:"deviceId"`
	FromVersionCode *int64 `json:"fromVersionCode"`
	ToVersionCode   *int64 `json:"toVersionCode"`
	Event           string `json:"event"`
	FailCode        string `json:"failCode"`
	NetworkType     string `json:"networkType"`
	OSVersion       string `json:"osVersion"`
	DeviceModel     string `json:"deviceModel"`
	CostMS          *int64 `json:"costMs"`
}

type AuditLog struct {
	ID           int64          `json:"id"`
	UserID       *int64         `json:"userId,omitempty"`
	Username     string         `json:"username"`
	Action       string         `json:"action"`
	ResourceType string         `json:"resourceType"`
	ResourceID   string         `json:"resourceId,omitempty"`
	Details      map[string]any `json:"details,omitempty"`
	IP           string         `json:"ip,omitempty"`
	UserAgent    string         `json:"userAgent,omitempty"`
	CreatedAt    time.Time      `json:"createdAt"`
}

type Metrics struct {
	Version          string              `json:"version"`
	UptimeSeconds    int64               `json:"uptimeSeconds"`
	GoVersion        string              `json:"goVersion"`
	Memory           MemoryMetrics       `json:"memory"`
	QPS              float64             `json:"qps"`
	Database         DatabaseMetrics     `json:"database"`
	Storage          StorageMetrics      `json:"storage"`
	Counts           CountMetrics        `json:"counts"`
	Roots            []RootMetrics       `json:"roots"`
	Shares           ShareStatusMetric   `json:"shares"`
	Apps             VersionStatusMetric `json:"apps"`
	UpgradeEvents24h map[string]int      `json:"upgradeEvents24h"`
}

type RootMetrics struct {
	RootID    string `json:"rootId"`
	RootName  string `json:"rootName"`
	FileCount int    `json:"fileCount"`
	TotalSize int64  `json:"totalSize"`
}

type ShareStatusMetric struct {
	Total   int `json:"total"`
	Active  int `json:"active"`
	Expired int `json:"expired"`
}

type VersionStatusMetric struct {
	Total     int `json:"total"`
	Draft     int `json:"draft"`
	Gray      int `json:"gray"`
	Published int `json:"published"`
	Offline   int `json:"offline"`
}

type MemoryMetrics struct {
	RSS       uint64 `json:"rss"`
	HeapAlloc uint64 `json:"heapAlloc"`
	HeapSys   uint64 `json:"heapSys"`
	Sys       uint64 `json:"sys"`
	NumGC     uint32 `json:"numGC"`
}

type DatabaseMetrics struct {
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	WALSize int64  `json:"walSize"`
}

type StorageMetrics struct {
	FileRoot  string `json:"fileRoot"`
	FileCount int    `json:"fileCount"`
	TotalSize int64  `json:"totalSize"`
}

type CountMetrics struct {
	Users         int `json:"users"`
	Files         int `json:"files"`
	Shares        int `json:"shares"`
	AppVersions   int `json:"appVersions"`
	UpgradeEvents int `json:"upgradeEvents"`
	AuditLogs     int `json:"auditLogs"`
}

type BrowseResult struct {
	Path      string        `json:"path"`
	Parent    string        `json:"parent"`
	Entries   []BrowseEntry `json:"entries"`
	Truncated bool          `json:"truncated"`
	Total     int           `json:"total"`
}

type BrowseEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type BrowseBound struct {
	Path   string `json:"path"`
	Label  string `json:"label"`
	Source string `json:"source"`
}

type BrowseRoot struct {
	Path   string `json:"path"`
	Label  string `json:"label"`
	RootID string `json:"rootId"`
}

type BrowseBounds struct {
	Bounds []BrowseBound `json:"bounds"`
	Roots  []BrowseRoot  `json:"roots"`
}

// UploadFailure 描述一次 multipart 上传中未能存储的文件。
// 批次中的其余文件仍会正常提交。
type UploadFailure struct {
	Name  string `json:"name"`
	Error string `json:"error"`
}

type UploadResult struct {
	Uploaded []FileEntry     `json:"uploaded"`
	Failed   []UploadFailure `json:"failed"`
}

type ShareFile struct {
	Index     int    `json:"index"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Size      int64  `json:"size"`
	Extension string `json:"extension"`
	URL       string `json:"url"`
	// 当文件在创建分享后已从存储中删除时，Exists 为 false。
	// 公开列表会保留该条目，便于客户端展示。
	Exists bool `json:"exists"`
}

type ShareContent struct {
	Share ShareInfo   `json:"share"`
	Files []ShareFile `json:"files"`
}

// FunnelVersion 汇总某个目标版本的升级事件。
type FunnelVersion struct {
	ToVersionCode int64          `json:"toVersionCode"`
	VersionName   string         `json:"versionName"`
	Events        map[string]int `json:"events"`
}

// FunnelResult 是某应用在时间窗口内的升级漏斗。
type FunnelResult struct {
	AppKey             string          `json:"appKey"`
	Items              []FunnelVersion `json:"items"`
	CheckNoUpdateTotal int             `json:"checkNoUpdateTotal"`
}

type SidebarMetrics struct {
	Files       int   `json:"files"`
	Shares      int   `json:"shares"`
	Users       int   `json:"users"`
	AppVersions int   `json:"appVersions"`
	TotalSize   int64 `json:"totalSize"`
}

// CreateAppRequest 用于登记新的应用 key。
type CreateAppRequest struct {
	AppKey   string `json:"appKey"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

type UpdateAppRequest struct {
	Name     *string `json:"name"`
	AppKey   *string `json:"appKey"`
	Platform string  `json:"platform"`
}

// AppDeleteResult 报告随应用一并删除的内容。
type AppDeleteResult struct {
	VersionCount int `json:"versionCount"`
	EventCount   int `json:"eventCount"`
}

// RollbackCandidatesResponse 列出早于当前版本的候选版本。
type RollbackCandidatesResponse struct {
	Candidates []AppVersion `json:"candidates"`
}

type AppEvent struct {
	Event string `json:"event"`
	Count int    `json:"count"`
}

type AppStats struct {
	Downloads int        `json:"downloads"`
	Events    []AppEvent `json:"events"`
}
