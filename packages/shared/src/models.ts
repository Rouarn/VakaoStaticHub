/**
 * 前后端共享的业务模型类型。
 *
 * 这些类型同时被 backend 的 controller/service 与 frontend 的 api/store 使用，
 * 通过 @vakao/shared 统一导出，避免前后端各自维护造成类型漂移。
 */
export interface ResourceRoot {
  id: string;
  name: string;
  path: string;
}

/** 根目录索引任务状态（GET /roots/index-status，仅内存态） */
export type RootIndexState = 'idle' | 'running' | 'done' | 'failed';

export interface RootIndexStatus {
  rootId: string;
  state: RootIndexState;
  /** 已发现（遍历到）的文件数 */
  scannedFiles: number;
  /** 已写入索引的文件数 */
  indexedFiles: number;
  /** 当前扫描目录，相对根目录 */
  currentDir: string;
  /** 开始时间（Unix 毫秒），未扫描过为 0；每次扫描独立记录 */
  startedAt: number;
  /** 结束时间（Unix 毫秒），未结束为 0 */
  finishedAt: number;
  /** 本次扫描耗时（毫秒），未结束为 0 */
  durationMs: number;
  /** 失败原因，成功时为空字符串 */
  error: string;
}

/** 手动重建索引（POST /files/index）的入队结果 */
export interface ReindexResult {
  /** 本次真正入队的根目录 */
  queued: string[];
  /** 入队前的状态，作为判断本次扫描是否结束的基线 */
  status: RootIndexStatus[];
}

/**
 * 服务器目录浏览（GET /roots/browse）
 *
 * 仅枚举目录、不返回文件；仅允许浏览「已配置根目录的父级、用户主目录、
 * ROOT_BROWSE_WHITELIST 白名单」范围内的绝对路径。
 */
export interface BrowseDirectoryEntry {
  /** 目录名（不含路径） */
  name: string;
  /** 绝对路径 */
  path: string;
}

/** GET /roots/browse 的响应数据 */
export interface BrowseDirectoriesResult {
  /** 当前目录的绝对路径（符号链接已解析为真实路径） */
  path: string;
  /** 上级目录；已到达允许浏览的边界时为 null（不能再向上） */
  parent: string | null;
  /** 子目录列表（不包含文件与符号链接） */
  entries: BrowseDirectoryEntry[];
  /** 是否因单次条目上限被截断 */
  truncated: boolean;
  /** 截断前扫描到的子目录总数 */
  total: number;
}

/** 单次目录浏览返回的最大条目数（超出部分截断并标记 truncated） */
export const ROOT_BROWSE_MAX_ENTRIES = 500;

/** 默认资源根的固定 id（与后端 store.DefaultRootID 保持一致） */
export const DEFAULT_ROOT_ID = 'default';

/**
 * APP 更新包目录：既是默认根下的分类，也是独立的资源根
 *
 * 默认根下已不重复展示该分类，前端所有根目录列表都按独立根的口径排除它。
 */
export const PACKAGE_ROOT_ID = 'software-update';

/** 服务端内置目录：前端不允许重命名或删除 */
export const SYSTEM_ROOT_IDS: readonly string[] = [
  DEFAULT_ROOT_ID,
  PACKAGE_ROOT_ID,
];

/** 允许浏览/创建根目录的边界来源 */
export type BrowseBoundSource = 'root-parent' | 'whitelist' | 'home';

/** 一条允许的目录边界（GET /roots/browse/bounds） */
export interface BrowseBound {
  /** 边界绝对路径（realpath 归一后） */
  path: string;
  /** 展示用来源说明 */
  label: string;
  /** 来源：根目录父级 / 白名单 / 运行用户主目录 */
  source: BrowseBoundSource;
}

/** GET /roots/browse/bounds 的响应数据 */
export interface BrowseBoundsResult {
  /** 允许浏览/创建根目录的边界 */
  bounds: BrowseBound[];
  /** 已配置的根目录，作为快捷入口直接跳转 */
  roots: BrowseShortcut[];
}

/** 已配置根目录的快捷入口（GET /roots/browse/bounds 的 roots 字段） */
export interface BrowseShortcut {
  /** 根目录真实绝对路径 */
  path: string;
  /** 根目录显示名称 */
  label: string;
  /** 根目录 ID */
  rootId: string;
}

export interface FileItem {
  /** 文件索引 id，用于拼接内容直链 `/v1/i/{id}` */
  id: number;
  name: string;
  path: string;
  size: number;
  mtime: number;
  /** 内容版本（`size-mtimeMs`），拼图片地址时作为缓存版本参数 */
  version: string;
}

/** 文件管理相关的服务端下发配置 */
export interface FileConfig {
  /** 默认兜底分类名（后端 DEFAULT_CATEGORY 环境变量），该分类不允许重命名 */
  defaultCategory: string;
}

export interface ShareLink {
  id: number;
  token: string;
  rootId: string;
  category: string;
  /** 分享类型，由 filePaths 长度派生：1 个为 file，多个为 collection */
  shareType: 'file' | 'collection';
  /** 分享文件的相对路径列表，长度至少 1 */
  filePaths: string[];
  /** 后台备注（不对外公开） */
  remark: string | null;
  /** 是否启用；停用后公开访问返回明确“已停用” */
  enabled: boolean;
  expiresAt: number | null;
  /** 最大打开次数，null 表示不限制；打开后下载文件不再计数 */
  maxAccesses: number | null;
  /** 已成功打开（解锁）次数 */
  accessCount: number;
  createdAt: number;
  /** 是否设置了访问密码（不会返回密码哈希本身） */
  hasPassword?: boolean;
}

/** 分享链接状态（管理端列表筛选与展示口径） */
export type ShareLinkStatus = 'active' | 'expired' | 'exhausted' | 'disabled';

/** 分享链接列表查询参数（GET /share/list） */
export interface ShareListQuery {
  page?: number;
  pageSize?: number;
  /** 关键字：命中 token / 文件路径 / 分类 / 备注 */
  q?: string;
  status?: ShareLinkStatus;
}

/** 分享链接服务端分页结果（GET /share/list） */
export interface ShareListResult {
  items: ShareLink[];
  total: number;
  page: number;
  pageSize: number;
  /** 各状态数量（服务端统计，不受当前页影响） */
  counts: {
    all: number;
    active: number;
    expired: number;
    exhausted: number;
    disabled: number;
  };
}

/**
 * 批量分享操作的动作。
 *
 * 后端没有批量接口：前端对每条链接复用单条
 * `PATCH /share/:token`（enable / disable）与 `DELETE /share/:token`（delete），
 * 逐条收集结果以如实呈现部分失败。
 */
export type ShareBatchAction = 'enable' | 'disable' | 'delete';

/** 批量操作中单条链接的执行结果 */
export interface ShareBatchItemResult {
  token: string;
  success: boolean;
  /** 失败原因（后端 message 或网络错误文案），成功时不返回 */
  error?: string;
}

/** 批量操作汇总（前端逐条调用单条接口后自行聚合，后端不感知） */
export interface ShareBatchResult {
  action: ShareBatchAction;
  total: number;
  succeeded: number;
  failed: number;
  results: ShareBatchItemResult[];
}

/** 分享链接编辑参数（PATCH /share/:token） */
export interface UpdateShareLinkParams {
  /** 备注；null 表示清空 */
  remark?: string | null;
  /** 绝对过期时间戳；null 表示永久有效 */
  expiresAt?: number | null;
  /** 新密码；null 表示清除密码，不传表示保持不变 */
  password?: string | null;
  /** 最大打开次数；null 表示不限制 */
  maxAccesses?: number | null;
  /** 启停开关 */
  enabled?: boolean;
}

/** 分享链接的公开信息（用于访问前判断是否需要密码） */
export interface ShareInfo {
  token: string;
  rootId: string;
  category: string;
  /** 由 filePaths 长度派生 */
  shareType: 'file' | 'collection';
  /** 分享文件的相对路径列表，长度至少 1 */
  filePaths: string[];
  expiresAt: number | null;
  maxAccesses: number | null;
  hasPassword: boolean;
}

/** 多文件分享（collection）中的单个文件项（含存在性探测，避免已删除文件静默消失） */
export interface ShareCollectionFile {
  /** 分类内相对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 字节数；文件已删除时为 null */
  size: number | null;
  /** 磁盘上是否仍存在 */
  exists: boolean;
}

/** 多文件分享文件列表（GET /share/:token?accessToken=...） */
export interface ShareCollectionResult {
  shareType: 'collection';
  rootId: string;
  category: string;
  files: ShareCollectionFile[];
}

/** 分享访问令牌有效期：30 分钟（后端签发与前端「令牌已过期」提示共用） */
export const SHARE_ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;

/** 分享访问令牌传递的 query 参数名 */
export const SHARE_ACCESS_TOKEN_QUERY = 'accessToken';

/**
 * 分享访问令牌（accessToken）的正式契约
 *
 * - 签发：`POST /share/:token/verify` 解锁成功后返回，一次打开只签发一次
 * - 形态：`<issuedAt>.<hmac>`，`issuedAt` 为毫秒时间戳，`hmac` 为
 *   `HMAC-SHA256(JWT_SECRET, '<shareToken>.<issuedAt>')` 的 64 位小写 hex
 * - 绑定：只对签发时的分享 token 有效，不能跨链接复用
 * - 有效期：`SHARE_ACCESS_TOKEN_TTL_MS`（30 分钟），超期需重新解锁
 * - 传递：`GET /share/:token?accessToken=<token>`（下载/预览/多文件列表通用）
 * - 失效：超期、链接被停用/过期/撤销、服务端密钥变更 → 401
 */
export interface ShareAccessGrant {
  success: true;
  accessToken: string;
}

/**
 * 分享链接不可用的三类原因：
 * expired 已过期 / exhausted 打开次数用尽 / disabled 已被停用。
 * 公开访问接口统一返回 410 Gone，并用 message 区分具体原因。
 */
export type ShareUnavailableReason = 'expired' | 'exhausted' | 'disabled';

export interface CreateShareLinkParams {
  rootId: string;
  category: string;
  /** 分享文件的相对路径列表，长度 1..200；1 个即单文件分享 */
  filePaths: string[];
  /** 后台备注 */
  remark?: string;
  expiresInMs?: number;
  /** 最大打开次数；链接每被成功解锁一次计 1 次，打开后下载文件不计数 */
  maxAccesses?: number;
  /** 访问密码，可选，传入后访问分享需要密码验证 */
  password?: string;
}

/** 分享访问记录 */
export interface ShareAccessLog {
  id: number;
  shareToken: string;
  ip: string | null;
  userAgent: string | null;
  accessedAt: number;
}

/** 用户角色：admin 管理员 / user 普通用户 */
export type UserRole = 'admin' | 'user';

/** 登录用户基础信息（不含密码等敏感字段） */
export interface UserInfo {
  id: number;
  username: string;
  role: UserRole;
  createdAt: number;
}

/** 注册请求参数 */
export interface RegisterParams {
  username: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: UserInfo;
}

export type ViewMode = 'grid' | 'list';
export type SortField = 'name' | 'size' | 'mtime';
export type SortOrder = 'asc' | 'desc';

/** APP 版本状态：0 草稿 / 1 灰度 / 2 全量 / 3 已下架 */
export type AppVersionStatus = 0 | 1 | 2 | 3;

export interface AppVersion {
  id: number;
  platform: string;
  /** 应用标识（software-update 根下的分类目录名，如 xiaolv / xiaolan） */
  appKey: string;
  versionName: string;
  versionCode: number;
  updateType: string;
  packageSize: number;
  checksum: string;
  storageRootId: string;
  category: string;
  relPath: string;
  updateLog: string | null;
  forceUpdate: number;
  minVersionCode: number;
  grayPercent: number;
  /** 灰度自动递增开关 0/1 */
  grayAutoIncrement: number;
  /** 灰度递增时间表 JSON：[{ "hours": 24, "percent": 30 }, ...] */
  grayIncrementSchedule: string | null;
  /** 定时发布时间戳（毫秒），仅草稿生效 */
  scheduledPublishAt: number | null;
  /** 定时发布模式：full 全量 / gray 灰度 */
  scheduledPublishMode: string;
  /** 定时灰度发布的灰度百分比 */
  scheduledGrayPercent: number;
  status: AppVersionStatus;
  /** 下架原因：auto 被新全量自动挤掉 / manual 管理员手动下架 / null 未下架 */
  offlineReason: 'auto' | 'manual' | null;
  publishTime: number | null;
  remark: string | null;
  createdAt: number;
  updatedAt: number;
}

export type UpgradeEventName =
  | 'check_no_update'
  | 'prompt_show'
  | 'download_start'
  | 'download_success'
  | 'download_fail'
  | 'verify_fail'
  | 'install_success'
  | 'install_fail'
  | 'new_version_launch';

export interface AppUpgradeEvent {
  id: number;
  deviceId: string;
  appKey: string;
  fromVersionCode: number | null;
  toVersionCode: number | null;
  event: UpgradeEventName;
  failCode: string | null;
  networkType: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  costMs: number | null;
  createdAt: number;
}
