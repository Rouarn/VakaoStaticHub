package httpapi

// 本文件是 HTTP 契约的唯一事实来源。每条路由都在此
// 列出方法、路径、鉴权级别与载荷结构。其他文件中的处理函数
// 必须与本表严格一致；不存在自动生成的规范。
//
// 约定
//
//   - 基础路径为 /api/v1。所有 JSON 响应统一为
//     {"code":200,"message":"ok","data":...}；列表分页结构位于 data 内：
//     {"items":[],"total":n,"page":p,"pageSize":s}。
//   - 错误使用同一外层信封：code 为 HTTP 状态码、message 为错误说明、data 为 null。
//   - 非 JSON 端点（文件流、图片、安装包下载、占位图、SPA 静态资源）
//     直接返回原始字节，不使用信封；其错误仍为 JSON 信封。
//   - 鉴权使用 POST /auth/login 签发的 "Authorization: Bearer <token>"。
//   - JSON 中时间为 RFC 3339；存储使用 Unix 毫秒。
//   - 文件内容端点有意设计为公开：面板需要直接使用 <img>
//     标签，而分享链接由各自的 Token 保护。

type AuthLevel string

const (
	Public AuthLevel = "public"
	User   AuthLevel = "user"
	Admin  AuthLevel = "admin"
)

// Route 描述一个端点。
type Route struct {
	Method  string
	Path    string
	Auth    AuthLevel
	Summary string
}

// Contract 是固定的 API 接口面。Implemented 表示该路由是否
// 已接入处理函数（模块逐步落地时用于启动日志）。
type ContractEntry struct {
	Route
	Implemented bool
}

var contractEntries = []ContractEntry{
	// 系统
	{Route{"GET", "/healthz", Public, "liveness/readiness probe"}, true},

	// 认证
	{Route{"POST", "/api/v1/auth/login", Public, "exchange credentials for a bearer token (5/min/IP)"}, true},
	{Route{"GET", "/api/v1/auth/me", User, "current user profile"}, true},
	{Route{"POST", "/api/v1/auth/logout", User, "client-side token revocation"}, true},
	{Route{"PATCH", "/api/v1/auth/password", User, "change own password"}, true},

	// 用户（管理员）
	{Route{"GET", "/api/v1/users", Admin, "paged user list (q)"}, true},
	{Route{"POST", "/api/v1/users", Admin, "create user"}, true},
	{Route{"PATCH", "/api/v1/users/{id}/password", Admin, "reset another user's password"}, true},
	{Route{"DELETE", "/api/v1/users/{id}", Admin, "delete user"}, true},

	// 资源根目录
	{Route{"GET", "/api/v1/roots", User, "list storage roots"}, true},
	{Route{"POST", "/api/v1/roots", User, "create a storage root"}, true},
	{Route{"PATCH", "/api/v1/roots/{id}", User, "rename/move a storage root"}, true},
	{Route{"DELETE", "/api/v1/roots/{id}", User, "delete an empty storage root"}, true},
	{Route{"GET", "/api/v1/roots/browse", User, "browse server directories (path)"}, true},
	{Route{"GET", "/api/v1/roots/browse/bounds", User, "browse boundaries and root shortcuts"}, true},

	// 文件
	{Route{"GET", "/api/v1/files/config", User, "upload/image limits for the panel"}, true},
	{Route{"GET", "/api/v1/files", User, "paged file list (rootId,category,q,sort,order,page,pageSize)"}, true},
	{Route{"GET", "/api/v1/files/categories", User, "categories with counts (rootId)"}, true},
	{Route{"POST", "/api/v1/files/categories", User, "create a category"}, true},
	{Route{"PATCH", "/api/v1/files/categories", User, "rename a category"}, true},
	{Route{"DELETE", "/api/v1/files/categories", User, "delete a category (recursive)"}, true},
	{Route{"GET", "/api/v1/files/stats", User, "storage usage grouped by root/category"}, true},
	{Route{"GET", "/api/v1/files/duplicates", User, "duplicate content groups"}, true},
	{Route{"POST", "/api/v1/files/index", User, "rescan disk and refresh the index"}, true},
	{Route{"POST", "/api/v1/files/batch-delete", User, "delete several files"}, true},
	{Route{"POST", "/api/v1/files/batch-move", User, "move several files to another category"}, true},
	{Route{"PATCH", "/api/v1/files/rename", User, "rename one file"}, true},
	{Route{"DELETE", "/api/v1/files", User, "delete one file (rootId,category,path)"}, true},
	{Route{"GET", "/api/v1/files/content/{rootId}/{category}/{path...}", Public, "serve/thumbnail file bytes (Range, w, h, format=jpeg|webp, q, download)"}, true},

	// 上传
	{Route{"POST", "/api/v1/files/upload", User, "multipart upload (files[])"}, true},
	{Route{"POST", "/api/v1/uploads", User, "start a chunked upload"}, true},
	{Route{"PUT", "/api/v1/uploads/{id}/chunks/{index}", User, "write one chunk (raw body)"}, true},
	{Route{"POST", "/api/v1/uploads/{id}/complete", User, "merge chunks and register the file"}, true},
	{Route{"DELETE", "/api/v1/uploads/{id}", User, "cancel a chunked upload"}, true},

	// 分享链接（管理端）
	{Route{"GET", "/api/v1/shares", User, "paged share list (q,status)"}, true},
	{Route{"POST", "/api/v1/shares", User, "create a share link"}, true},
	{Route{"PATCH", "/api/v1/shares/{token}", User, "update a share link"}, true},
	{Route{"DELETE", "/api/v1/shares/{token}", User, "revoke a share link"}, true},
	{Route{"GET", "/api/v1/shares/{token}/access-logs", User, "paged access log"}, true},

	// 分享链接（公开）
	{Route{"GET", "/api/v1/public/shares/{token}", Public, "share metadata (410 when unavailable)"}, true},
	{Route{"POST", "/api/v1/public/shares/{token}/unlock", Public, "exchange the password for an access token (10/min/IP)"}, true},
	{Route{"GET", "/api/v1/public/shares/{token}/files", Public, "list shared files (accessToken)"}, true},
	{Route{"GET", "/api/v1/public/shares/{token}/files/{index}", Public, "stream one shared file (Range, w, h, format, q, download)"}, true},

	// APP 发布（管理端）
	{Route{"GET", "/api/v1/apps", User, "list apps"}, true},
	{Route{"POST", "/api/v1/apps", User, "create app"}, true},
	{Route{"PATCH", "/api/v1/apps/{appKey}", User, "rename app"}, true},
	{Route{"DELETE", "/api/v1/apps/{appKey}", User, "delete app and its versions"}, true},
	{Route{"GET", "/api/v1/apps/{appKey}/versions", User, "paged version list (platform,status)"}, true},
	{Route{"POST", "/api/v1/apps/{appKey}/versions", User, "upload a package and create a draft"}, true},
	{Route{"GET", "/api/v1/app-versions/{id}", User, "version detail"}, true},
	{Route{"PATCH", "/api/v1/app-versions/{id}", User, "edit version metadata"}, true},
	{Route{"DELETE", "/api/v1/app-versions/{id}", User, "delete a draft/offline version and its file"}, true},
	{Route{"POST", "/api/v1/app-versions/{id}/publish", User, "publish full or gray"}, true},
	{Route{"POST", "/api/v1/app-versions/{id}/offline", User, "take a version offline"}, true},
	{Route{"POST", "/api/v1/app-versions/{id}/rollback", User, "rollback to a previous version"}, true},
	{Route{"PUT", "/api/v1/app-versions/{id}/force", User, "toggle forced update without republishing"}, true},
	{Route{"GET", "/api/v1/app-versions/{id}/rollback-candidates", User, "versions eligible as rollback target"}, true},
	{Route{"GET", "/api/v1/apps/{appKey}/funnel", User, "upgrade funnel by version (startTime,endTime)"}, true},

	// APP 发布（客户端）
	{Route{"GET", "/api/v1/public/apps/{appKey}/update", Public, "check for updates (platform,versionCode,deviceId)"}, true},
	{Route{"GET", "/api/v1/public/apps/versions/{id}/download", Public, "download a package (Range supported)"}, true},
	{Route{"POST", "/api/v1/public/apps/events", Public, "report upgrade events"}, true},

	// 可观测性
	{Route{"GET", "/api/v1/audit-logs", User, "paged audit log (userId,action,startTime,endTime)"}, true},
	{Route{"GET", "/api/v1/metrics", User, "runtime, database and storage metrics"}, true},
	{Route{"GET", "/api/v1/metrics/sidebar", User, "compact counts for the sidebar"}, true},

	// 杂项公开辅助接口
	{Route{"GET", "/api/v1/public/hitokoto", Public, "proxied one-line quote"}, true},
	{Route{"GET", "/api/v1/public/photo", Public, "random image bytes (rootId, category, w, h, format, q)"}, true},
	{Route{"GET", "/api/v1/public/placeholder", Public, "generated SVG placeholder"}, true},
}
