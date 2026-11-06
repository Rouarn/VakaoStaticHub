package httpapi

// 本文件是 HTTP 契约的唯一事实来源。每条路由都在此
// 列出方法、路径、鉴权级别与载荷结构。其他文件中的处理函数
// 必须与本表严格一致；不存在自动生成的规范。
//
// 约定
//
//   - 基础路径为 /v1。所有 JSON 响应统一为
//     {"code":200,"message":"ok","data":...}；列表分页结构位于 data 内：
//     {"items":[],"total":n,"page":p,"pageSize":s}。
//   - 公开高频入口使用单字母短前缀：/v1/i 为内容与图片（按 id 取文件、
//     随机图、占位图），/v1/s 为分享，/v1/a 为 APP 更新；其余管理端
//     CRUD 保持完整的 REST 命名。
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
	{Route{"GET", "/healthz", Public, "存活与就绪探针"}, true},

	// 认证
	{Route{"POST", "/v1/auth/login", Public, "用账号密码换取 Bearer 令牌（每 IP 每分钟 5 次）"}, true},
	{Route{"GET", "/v1/auth/me", User, "当前用户信息"}, true},
	{Route{"POST", "/v1/auth/logout", User, "客户端注销令牌"}, true},
	{Route{"PATCH", "/v1/auth/password", User, "修改自己的密码"}, true},

	// 用户（管理员）
	{Route{"GET", "/v1/users", Admin, "分页用户列表（q）"}, true},
	{Route{"POST", "/v1/users", Admin, "创建用户"}, true},
	{Route{"PATCH", "/v1/users/{id}/password", Admin, "重置其他用户的密码"}, true},
	{Route{"DELETE", "/v1/users/{id}", Admin, "删除用户"}, true},

	// 资源根目录
	{Route{"GET", "/v1/roots", User, "列出资源根目录"}, true},
	{Route{"POST", "/v1/roots", User, "创建资源根目录"}, true},
	{Route{"PATCH", "/v1/roots/{id}", User, "重命名或移动资源根目录"}, true},
	{Route{"DELETE", "/v1/roots/{id}", User, "删除空资源根目录"}, true},
	{Route{"GET", "/v1/roots/browse", User, "浏览服务器目录（path）"}, true},
	{Route{"GET", "/v1/roots/browse/bounds", User, "浏览授权边界与根目录快捷入口"}, true},

	// 文件
	{Route{"GET", "/v1/files/config", User, "面板的上传与图片限制"}, true},
	{Route{"GET", "/v1/files", User, "分页文件列表（rootId、category、q、sort、order、page、pageSize）"}, true},
	{Route{"GET", "/v1/files/categories", User, "带文件数量的分类列表（rootId）"}, true},
	{Route{"POST", "/v1/files/categories", User, "创建分类"}, true},
	{Route{"PATCH", "/v1/files/categories", User, "重命名分类"}, true},
	{Route{"DELETE", "/v1/files/categories", User, "删除分类（recursive 递归）"}, true},
	{Route{"GET", "/v1/files/stats", User, "按资源根目录与分类统计的存储用量"}, true},
	{Route{"GET", "/v1/files/duplicates", User, "重复内容分组"}, true},
	{Route{"POST", "/v1/files/index", User, "重新扫描磁盘并刷新索引"}, true},
	{Route{"POST", "/v1/files/batch-delete", User, "批量删除文件"}, true},
	{Route{"POST", "/v1/files/batch-move", User, "批量移动文件到其他分类"}, true},
	{Route{"PATCH", "/v1/files/rename", User, "重命名单个文件"}, true},
	{Route{"DELETE", "/v1/files", User, "删除单个文件（rootId、category、path）"}, true},
	{Route{"GET", "/v1/i/{fileId}", Public, "按 id 读取文件内容或缩略图（Range、w、h、format=jpeg|webp、q、download）"}, true},

	// 上传
	{Route{"POST", "/v1/files/upload", User, "multipart 表单上传（files[]）"}, true},
	{Route{"POST", "/v1/uploads", User, "开始分片上传"}, true},
	{Route{"PUT", "/v1/uploads/{id}/chunks/{index}", User, "写入单个分片（原始请求体）"}, true},
	{Route{"POST", "/v1/uploads/{id}/complete", User, "合并分片并登记文件"}, true},
	{Route{"DELETE", "/v1/uploads/{id}", User, "取消分片上传"}, true},

	// 分享链接（管理端）
	{Route{"GET", "/v1/shares", User, "分页分享列表（q、status）"}, true},
	{Route{"POST", "/v1/shares", User, "创建分享链接"}, true},
	{Route{"PATCH", "/v1/shares/{token}", User, "更新分享链接"}, true},
	{Route{"DELETE", "/v1/shares/{token}", User, "撤销分享链接"}, true},
	{Route{"GET", "/v1/shares/{token}/access-logs", User, "分页访问日志"}, true},

	// 分享链接（公开）
	{Route{"GET", "/v1/s/{token}", Public, "分享元信息（不可用时返回 410）"}, true},
	{Route{"POST", "/v1/s/{token}/unlock", Public, "用访问密码换取访问令牌（每 IP 每分钟 10 次）"}, true},
	{Route{"GET", "/v1/s/{token}/f", Public, "列出分享文件（accessToken）"}, true},
	{Route{"GET", "/v1/s/{token}/f/{index}", Public, "读取单个分享文件（Range、w、h、format、q、download）"}, true},

	// APP 发布（管理端）
	{Route{"GET", "/v1/apps", User, "列出应用"}, true},
	{Route{"POST", "/v1/apps", User, "创建应用"}, true},
	{Route{"PATCH", "/v1/apps/{appKey}", User, "重命名应用"}, true},
	{Route{"DELETE", "/v1/apps/{appKey}", User, "删除应用及其版本"}, true},
	{Route{"GET", "/v1/apps/{appKey}/versions", User, "分页版本列表（platform、status）"}, true},
	{Route{"POST", "/v1/apps/{appKey}/versions", User, "上传安装包并创建草稿"}, true},
	{Route{"GET", "/v1/app-versions/{id}", User, "版本详情"}, true},
	{Route{"PATCH", "/v1/app-versions/{id}", User, "编辑版本元信息"}, true},
	{Route{"DELETE", "/v1/app-versions/{id}", User, "删除草稿或已下架版本及其安装包"}, true},
	{Route{"POST", "/v1/app-versions/{id}/publish", User, "发布全量或灰度"}, true},
	{Route{"POST", "/v1/app-versions/{id}/offline", User, "下架版本"}, true},
	{Route{"POST", "/v1/app-versions/{id}/rollback", User, "回滚到更早版本"}, true},
	{Route{"PUT", "/v1/app-versions/{id}/force", User, "在不重新发布的情况下切换强制更新"}, true},
	{Route{"GET", "/v1/app-versions/{id}/rollback-candidates", User, "可作为回滚目标的版本"}, true},
	{Route{"GET", "/v1/apps/{appKey}/funnel", User, "按版本统计升级漏斗（startTime、endTime）"}, true},

	// APP 发布（客户端）
	{Route{"GET", "/v1/a/{appKey}/update", Public, "检查更新（platform、versionCode、deviceId）"}, true},
	{Route{"GET", "/v1/a/versions/{id}/download", Public, "下载安装包（支持 Range）"}, true},
	{Route{"POST", "/v1/a/events", Public, "上报升级事件"}, true},

	// 可观测性
	{Route{"GET", "/v1/audit-logs", User, "分页审计日志（userId、action、startTime、endTime）"}, true},
	{Route{"GET", "/v1/metrics", User, "运行时、数据库与存储指标"}, true},
	{Route{"GET", "/v1/metrics/sidebar", User, "侧边栏用的精简计数"}, true},

	// 杂项公开辅助接口
	{Route{"GET", "/v1/hitokoto", Public, "代理的一言短句"}, true},
	{Route{"GET", "/v1/i/photo", Public, "随机图片内容（rootId、category、w、h、format、q）"}, true},
	{Route{"GET", "/v1/i/placeholder", Public, "生成的 SVG 占位图"}, true},
	{Route{"GET", "/v1/i/placeholder/{width}/{height}", Public, "生成指定尺寸的 SVG 占位图"}, true},
	{Route{"GET", "/v1/i/placeholder/{size}", Public, "生成正方形 SVG 占位图"}, true},
}
