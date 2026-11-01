import type { Response, Request } from 'express';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import {
  getMimeType,
  isPreviewable,
} from '../modules/files/utils/mime-types.js';

export interface FileServeOptions {
  download?: string;
  cacheControl?: string;
}

/** APK 下载输出选项 */
export interface ApkServeOptions {
  /** 强 ETag，建议基于记录 id + checksum 前缀生成 */
  etag?: string;
}

/**
 * 解析单区间 HTTP Range 头（bytes=start-end / bytes=-suffix）
 *
 * @returns 合法区间；语法非法、多区间或越界时返回 null（调用方应响应 416）
 */
export function parseHttpRange(
  rangeHeader: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }

  let start: number;
  let end: number;
  if (match[1] === '') {
    // 后缀区间 bytes=-N：取文件末尾 N 字节
    const suffix = parseInt(match[2], 10);
    if (suffix === 0 || size === 0) {
      return null;
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(match[1], 10);
    end =
      match[2] === '' ? size - 1 : Math.min(parseInt(match[2], 10), size - 1);
  }

  if (size === 0 || start >= size || start > end) {
    return null;
  }
  return { start, end };
}

/**
 * 通用静态文件输出（支持 HTTP Range 边下边播）
 *
 * 响应行为：
 * - Accept-Ranges: bytes + 弱 ETag
 * - if-none-match 命中 → 304
 * - 无 Range / If-Range 不匹配 → 200 全量
 * - Range 合法 → 206 分片（视频/音频流式播放、拖动进度条依赖此行为）
 * - Range 非法或越界 → 416 + Content-Range: bytes *\/{size}
 */
export async function serveStaticFile(
  fullPath: string,
  filename: string,
  req: Request,
  res: Response,
  options: FileServeOptions = {},
) {
  const s = await stat(fullPath);
  const mimeType = getMimeType(filename);

  const etag = `W/"${s.size}-${s.mtimeMs}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', s.mtime.toUTCString());
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader(
    'Cache-Control',
    options.cacheControl ?? 'private, max-age=0, must-revalidate',
  );

  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.setHeader('Content-Type', mimeType);

  const disposition =
    isPreviewable(mimeType) && options.download === undefined
      ? 'inline'
      : 'attachment';

  if (disposition === 'attachment') {
    const encodedFilename = encodeURIComponent(basename(filename));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFilename}`,
    );
  } else {
    res.setHeader('Content-Disposition', disposition);
  }

  // If-Range 携带的标识与当前 ETag 不一致说明文件已变化，必须返回全量
  const rangeHeader = req.headers.range;
  const ifRange = req.headers['if-range'];
  const rangeUsable = Boolean(rangeHeader) && (!ifRange || ifRange === etag);

  if (rangeHeader && rangeUsable) {
    const parsed = parseHttpRange(rangeHeader, s.size);
    if (!parsed) {
      res
        .status(416)
        .setHeader('Content-Range', `bytes */${s.size}`)
        .end();
      return;
    }

    res.status(206);
    res.setHeader(
      'Content-Range',
      `bytes ${parsed.start}-${parsed.end}/${s.size}`,
    );
    res.setHeader('Content-Length', (parsed.end - parsed.start + 1).toString());
    createReadStream(fullPath, {
      start: parsed.start,
      end: parsed.end,
    }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', s.size.toString());
  createReadStream(fullPath).pipe(res);
}

/**
 * APK 安装包下载输出（支持 HTTP Range 断点续传）
 *
 * 与 serveStaticFile 分离的原因：APK 下载语义特殊——
 * 强 ETag（基于 checksum）、immutable 缓存、206/416/If-Range 分支多，
 * 独立实现避免影响 files 模块既有 304 语义。
 *
 * 响应行为：
 * - Accept-Ranges: bytes + 强 ETag + immutable 缓存
 * - if-none-match 命中 → 304
 * - 无 Range / If-Range 不匹配 → 200 全量
 * - Range 合法 → 206 分片（仅支持单区间 bytes=start-end / bytes=-suffix）
 * - Range 非法或越界 → 416 + Content-Range: bytes *\/size
 */
export async function serveApkFile(
  fullPath: string,
  req: Request,
  res: Response,
  options: ApkServeOptions = {},
) {
  const s = await stat(fullPath);
  const size = s.size;
  const etag = options.etag ?? `W/"apk-${size}-${s.mtimeMs}"`;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', s.mtime.toUTCString());
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch === etag) {
    res.status(304).end();
    return;
  }

  const rangeHeader = req.headers['range'];
  // If-Range 携带的标识与当前 ETag 不一致说明文件已变化，必须返回全量
  const ifRange = req.headers['if-range'];
  const rangeUsable = Boolean(rangeHeader) && (!ifRange || ifRange === etag);

  if (!rangeHeader || !rangeUsable) {
    res.setHeader('Content-Length', size.toString());
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(basename(fullPath))}`,
    );
    createReadStream(fullPath).pipe(res);
    return;
  }

  const parsed = parseHttpRange(rangeHeader, size);
  if (!parsed) {
    res
      .status(416)
      .setHeader('Content-Range', `bytes */${size}`)
      .end();
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${size}`);
  res.setHeader('Content-Length', (parsed.end - parsed.start + 1).toString());
  createReadStream(fullPath, { start: parsed.start, end: parsed.end }).pipe(
    res,
  );
}
