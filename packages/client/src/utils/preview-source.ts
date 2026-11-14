import { getFileKind } from './file-types';

/**
 * 预览地址修正
 *
 * 有些格式前端没有渲染器（演示文稿），需要后端先用 LibreOffice
 * 转成 PDF 再交给 PDF 预览。这里统一给内容地址追加 `as=pdf`，
 * 下载地址不经过这里，永远拿到原始文件。
 */

/** 需要服务端转 PDF 的类别 */
const CONVERTED_KINDS = new Set(['slides']);

/** 给内容地址追加 `as=pdf`（保留已有 query） */
export function withPdfConversion(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}as=pdf`;
}

/** 按文件名修正预览地址；无需转换时原样返回 */
export function previewSrc(filename: string, src: string): string {
  return CONVERTED_KINDS.has(getFileKind(filename))
    ? withPdfConversion(src)
    : src;
}
