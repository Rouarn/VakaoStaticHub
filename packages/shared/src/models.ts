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

export interface FileItem {
  name: string;
  path: string;
  size: number;
  mtime: number;
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
