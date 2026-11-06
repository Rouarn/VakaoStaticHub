/**
 * 文件 / 分享访问 URL 的唯一构造函数
 *
 * 全站（直链复制、缩略图、预览、下载、分享访问页、独立 /file-preview）
 * 都必须经过这里，禁止在组件或 api 文件里手工拼接文件路径。
 *
 * 关键约束：API 基址中的 `/v1` 只允许出现一次。
 * VITE_API_BASE_URL 既可能是 `http://host` 也可能是 `http://host/v1`，
 * 这里统一剥离尾部前缀后再拼一次，避免出现 `/v1/v1/...`。
 */

const API_PREFIX = '/v1';

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

/** API 基址的 origin 部分（不含 `/v1`） */
export function getApiOrigin(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  const base =
    envBase === 'origin' || !envBase ? window.location.origin : envBase;
  return normalizeOrigin(base);
}

/** 后端 API 统一基址（origin + `/v1`，且只出现一次） */
export function getApiBaseUrl(): string {
  return `${getApiOrigin()}${API_PREFIX}`;
}

export interface FileUrlParams {
  /** 内容短码（sha256 前 12 位），由后端随文件返回 */
  code: string;
  /** true 时追加 `download=1`，强制浏览器下载 */
  download?: boolean;
}

/** 文件直链：`<origin>/v1/i/<code>[?download=1]` */
export function buildFileUrl({ code, download }: FileUrlParams): string {
  const encoded = encodeURIComponent(code);
  const qs = download ? '?download=1' : '';
  return `${getApiOrigin()}${API_PREFIX}/i/${encoded}${qs}`;
}

/** 图片缩略图：文件直链 + 后端缩放参数，默认输出 JPEG */
export function buildThumbUrl(params: FileUrlParams, size = 320): string {
  const url = buildFileUrl(params);
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}w=${size}&h=${size}&format=jpeg&q=78`;
}

/**
 * 随机图片地址：`<origin>/v1/i/photo?rootId=..&category=..`
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
  return `${getApiBaseUrl()}/i/photo${suffix ? `?${suffix}` : ''}`;
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

/** 分享内文件访问地址：`<origin>/v1/s/<token>/f/<index>`，解锁后凭 accessToken 访问 */
export function buildShareFileUrl(
  token: string,
  { accessToken, index, download }: ShareFileUrlOptions = {},
): string {
  const query: string[] = [];
  if (accessToken) query.push(`accessToken=${encodeURIComponent(accessToken)}`);
  if (download) query.push('download=1');
  const qs = query.length > 0 ? `?${query.join('&')}` : '';
  const fileIndex = index ?? 0;
  return `${getApiBaseUrl()}/s/${encodeURIComponent(token)}/f/${fileIndex}${qs}`;
}

/**
 * 把后端返回的相对路径转成浏览器可访问的绝对地址。
 * 已是绝对 URL 的原样返回，绝不再叠加 API 基址。
 */
export function toAbsoluteUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${window.location.origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/** 独立预览页地址：`/file-preview?code=<code>&name=<原文件名>`，文件名用于判定预览类型 */
export function buildFilePreviewPageUrl({
  code,
  name,
  download,
}: FileUrlParams & { name?: string }): string {
  const query = new URLSearchParams({ code });
  if (name) query.set('name', name);
  if (download) query.set('download', '1');
  return `${window.location.origin}/file-preview?${query.toString()}`;
}
