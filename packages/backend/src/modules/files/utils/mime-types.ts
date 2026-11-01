/**
 * MIME 类型工具模块
 * 提供文件扩展名到 MIME 类型的映射和相关工具函数
 */

/**
 * MIME 类型映射表
 * 键为文件扩展名（小写，不含点号），值为对应的 MIME 类型
 */
export const MIME_TYPES: Record<string, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  apk: 'application/vnd.android.package-archive',
};

/**
 * 根据文件名获取 MIME 类型
 *
 * @param filename 文件名
 * @returns 对应的 MIME 类型，未知扩展名返回 'application/octet-stream'
 *
 * @example
 * getMimeType('image.jpg') // => 'image/jpeg'
 * @example
 * getMimeType('document.pdf') // => 'application/pdf'
 * @example
 * getMimeType('unknown.xyz') // => 'application/octet-stream'
 */
export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext
    ? MIME_TYPES[ext] || 'application/octet-stream'
    : 'application/octet-stream';
}

/**
 * 根据图片格式获取对应的 MIME 类型
 *
 * @param format 图片格式（如 'webp', 'jpeg', 'png'）
 * @returns 对应的 MIME 类型，未知格式返回 'image/webp'
 *
 * @example
 * getMimeTypeForFormat('webp') // => 'image/webp'
 * @example
 * getMimeTypeForFormat('jpg') // => 'image/jpeg'
 */
export function getMimeTypeForFormat(format: string): string {
  return MIME_TYPES[format.toLowerCase()] || 'image/webp';
}

/**
 * 判断文件是否可在浏览器中预览
 *
 * @param mimeType 文件的 MIME 类型
 * @returns 是否可预览
 *
 * @example
 * isPreviewable('image/jpeg') // => true
 * @example
 * isPreviewable('application/pdf') // => true
 * @example
 * isPreviewable('application/octet-stream') // => false
 */
export function isPreviewable(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/') ||
    mimeType === 'text/plain' ||
    mimeType === 'text/html'
  );
}
