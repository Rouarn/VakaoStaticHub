/**
 * 文件 / 分享访问 URL 的唯一构造函数
 *
 * 全站（直链复制、缩略图、预览、下载、分享访问页、独立 /file-preview）
 * 都必须经过这里，禁止在组件或 api 文件里手工拼接 `/static` 路径。
 *
 * 关键约束：API 基址与静态路径前缀中的 `/static` 只允许出现一次。
 * VITE_API_BASE_URL 既可能是 `http://host` 也可能是误写成 `http://host/static`，
 * 这里统一剥离尾部 `/static` 后再拼一次，避免出现 `/static/static/files/...`。
 */

const API_PREFIX = '/static';

/** 去掉 URL 结尾的斜杠与 `/static` 后缀，得到纯 origin（或 origin + 自定义前缀） */
function normalizeOrigin(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith(API_PREFIX)
    ? trimmed.slice(0, -API_PREFIX.length).replace(/\/+$/, '')
    : trimmed;
}

/** API 基址的 origin 部分（不含 `/static`） */
export function getApiOrigin(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  const base =
    envBase === 'origin' || !envBase ? window.location.origin : envBase;
  return normalizeOrigin(base);
}

/** 后端 API / 静态文件统一基址（origin + `/static`，且只出现一次） */
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

/** 文件直链：`<origin>/static/files/<rootId>/<category>/<relPath>` */
export function buildFileUrl({
  rootId,
  category,
  relPath,
  download,
}: FileUrlParams): string {
  const path = [
    API_PREFIX,
    'files',
    encodeURIComponent(rootId),
    encodePathSegments(category),
    encodePathSegments(relPath),
  ].join('/');
  return `${getApiOrigin()}${path}${download ? '?download=1' : ''}`;
}

/** 图片缩略图：文件直链 + 后端 sharp 缩放参数 */
export function buildThumbUrl(params: FileUrlParams, size = 320): string {
  const url = buildFileUrl(params);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${size}&h=${size}&format=webp&q=75`;
}

/** 分享页地址（前端路由，不是后端接口） */
export function buildSharePageUrl(token: string): string {
  return `${window.location.origin}/share/${encodeURIComponent(token)}`;
}

export interface ShareFileUrlOptions {
  accessToken?: string;
  /** collection 分享中的文件下标 */
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
  if (index !== undefined) query.push(`index=${index}`);
  if (download) query.push('download=1');
  const qs = query.length > 0 ? `?${query.join('&')}` : '';
  return `${getApiOrigin()}${API_PREFIX}/share/${encodeURIComponent(token)}${qs}`;
}

/**
 * 把后端返回的相对路径（已含 `/static`）转成浏览器可访问的绝对地址。
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
