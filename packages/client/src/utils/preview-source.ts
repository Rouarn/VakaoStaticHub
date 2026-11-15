import { getFileKind } from './file-types';

/**
 * 预览地址修正
 *
 * 有些格式前端没有渲染器（演示文稿），需要后端先用 LibreOffice
 * 转成 PDF 再交给 PDF 预览。转换结果按「文件版本」长缓存，所以地址里
 * 必须带版本标识：文件一变地址就变，覆盖后立刻能看到新结果；同一个
 * 版本则稳定命中 CDN/浏览器缓存，不再回源重新转换。下载地址不经过
 * 这里，永远拿到原始文件。
 */

/** 需要服务端转 PDF 的类别 */
const CONVERTED_KINDS = new Set(['slides']);

/**
 * 文件版本标识：列表里现成的「大小 + 修改时间」已经能区分同一路径的
 * 不同内容，不需要为版本额外发请求。缺任一项时返回 undefined。
 */
export function fileVersion(
  size: number | null | undefined,
  mtime: number | null | undefined,
): string | undefined {
  if (typeof size !== 'number' || size < 0) return undefined;
  if (typeof mtime !== 'number' || mtime <= 0) return undefined;
  return `${size}-${mtime}`;
}

/**
 * 拿不到版本信息的入口（手工输入的 `?file=` / `?url=`）用本页加载时的
 * 固定值：同一页面内地址稳定、可被 CDN 复用，下次打开页面即换新地址，
 * 不会把某个旧版本永久钉在缓存里。所有转换地址都带版本参数，不存在
 * 「带版本」与「不带版本」两套地址并行。
 */
const FALLBACK_VERSION = Date.now().toString(36);

/** 给内容地址追加 `as=pdf` 与文件版本（保留已有 query） */
export function withPdfConversion(url: string, version?: string): string {
  const separator = url.includes('?') ? '&' : '?';
  const value = encodeURIComponent(version ?? FALLBACK_VERSION);
  return `${url}${separator}as=pdf&v=${value}`;
}

/** 按文件名修正预览地址；无需转换时原样返回 */
export function previewSrc(
  filename: string,
  src: string,
  version?: string,
): string {
  return CONVERTED_KINDS.has(getFileKind(filename))
    ? withPdfConversion(src, version)
    : src;
}
