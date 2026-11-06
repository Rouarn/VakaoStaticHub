/**
 * 文件 / 分享访问 URL 的唯一构造函数
 *
 * 全站（直链复制、缩略图、预览、下载、分享访问页、独立 /file-preview）
 * 都必须经过这里，禁止在组件或 api 文件里手工拼接文件路径。
 *
 * 关键约束：API 基址中的 `/api/v1` 只允许出现一次。
 * VITE_API_BASE_URL 既可能是 `http://host` 也可能是 `http://host/api/v1`，
 * 这里统一剥离尾部前缀后再拼一次，避免出现 `/api/v1/api/v1/...`。
 */

const API_PREFIX = '/api/v1';

function stripPrefix(base: string, prefix: string): string {
  return base.endsWith(prefix)
    ? base.slice(0, -prefix.length).replace(/\/+$/, '')
    : base;
}

/** 去掉 URL 结尾的斜杠与 API 前缀，得到纯 origin（或 origin + 自定义前缀） */
function normalizeOrigin(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return stripPrefix(stripPrefix(trimmed, API_PREFIX), '/static');
}

/** API 基址的 origin 部分（不含 `/api/v1`） */
export function getApiOrigin(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  const base =
    envBase === 'origin' || !envBase ? window.location.origin : envBase;
  return normalizeOrigin(base);
}

/** 后端 API 统一基址（origin + `/api/v1`，且只出现一次） */
export function getApiBaseUrl(): string {
  return `${getApiOrigin()}${API_PREFIX}`;
}

/** 逐段编码：中文 / 空格 / # / % 都会被正确转义，路径分隔符 `/` 保留 */
function encodePathSegments(value: string): string {
  return value.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
}

export interface FileUrlParams {
  rootId: string;
  category: string;
  /** 分类内的相对路径（可含子目录） */
  relPath: string;
  /** true 时追加 `?download=1`，强制浏览器下载 */
  download?: boolean;
}

/** 文件直链：`<origin>/api/v1/files/content/<rootId>/<category>/<relPath>` */
export function buildFileUrl({
  rootId,
  category,
  relPath,
  download,
}: FileUrlParams): string {
  const path = [
    API_PREFIX,
    'files',
    'content',
    encodeURIComponent(rootId),
    encodePathSegments(category),
    encodePathSegments(relPath),
  ].join('/');
  return `${getApiOrigin()}${path}${download ? '?download=1' : ''}`;
}

/** 图片缩略图：文件直链 + 后端缩放参数，默认输出 JPEG */
export function buildThumbUrl(params: FileUrlParams, size = 320): string {
  const url = buildFileUrl(params);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${size}&h=${size}&format=jpeg&q=78`;
}

/**
 * 随机图片地址：`<origin>/api/v1/public/photo?rootId=..&category=..`
 *
 * 后端直接从随机池返回图片字节流；省略 rootId / category
 * 时范围依次扩大到「整个根目录」「全部分类」。
 * `cacheBust` 只用于打破浏览器缓存，不参与后端过滤。
 */
export function buildRandomPhotoUrl({
  rootId,
  category,
  cacheBust,
}: {
  rootId?: string | null;
  category?: string | null;
  cacheBust?: string | number;
}): string {
  const query = new URLSearchParams();
  if (rootId) query.set('rootId', rootId);
  if (category) query.set('category', category);
  if (cacheBust !== undefined) query.set('_t', String(cacheBust));
  const suffix = query.toString();
  return `${getApiBaseUrl()}/public/photo${suffix ? `?${suffix}` : ''}`;
}

/** 分享页地址（前端路由，不是后端接口） */
export function buildSharePageUrl(token: string): string {
  return `${window.location.origin}/share/${encodeURIComponent(token)}`;
}

export interface ShareFileUrlOptions {
  accessToken?: string;
  /** collection 分享中的文件下标；单文件分享为 0 */
  index?: number;
  download?: boolean;
}

/** 分享内文件访问地址：解锁后凭 accessToken 访问，不再消耗打开次数 */
export function buildShareFileUrl(
  token: string,
  { accessToken, index, download }: ShareFileUrlOptions = {},
): string {
  const query: string[] = [];
  if (accessToken) query.push(`accessToken=${encodeURIComponent(accessToken)}`);
  if (download) query.push('download=1');
  const qs = query.length > 0 ? `?${query.join('&')}` : '';
  const fileIndex = index ?? 0;
  return `${getApiBaseUrl()}/public/shares/${encodeURIComponent(token)}/files/${fileIndex}${qs}`;
}

/**
 * 把后端返回的相对路径转成浏览器可访问的绝对地址。
 * 已是绝对 URL 的原样返回，绝不再叠加 API 基址。
 */
export function toAbsoluteUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${window.location.origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/** 独立预览页地址（`/file-preview` 接受 rootId/category/path 参数，走统一构造） */
export function buildFilePreviewPageUrl(params: FileUrlParams): string {
  const query = new URLSearchParams({
    rootId: params.rootId,
    category: params.category,
    path: params.relPath,
  });
  if (params.download) query.set('download', '1');
  return `${window.location.origin}/file-preview?${query.toString()}`;
}
