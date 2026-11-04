import { registerAs } from '@nestjs/config';
import { join } from 'path';
import { tmpdir } from 'os';
import { getBackendRoot } from '../common/utils/backend-root.util.js';

export interface FileConfig {
  root: string;
  maxCount: number;
  defaultCategory: string;
  imageExtensions: string[];
  /** 分片上传临时目录，默认落在操作系统临时目录下的应用专属子目录；
   * 线上如把 /tmp 挂 tmpfs 且内存吃紧时可用 UPLOAD_TEMP_DIR 指回磁盘目录 */
  uploadTempDir: string;
  /** 单个分片文件大小硬上限（字节），防超大 buffer 打垮进程内存 */
  chunkFileSizeLimit: number;
}

export const fileConfigFactory = registerAs('files', (): FileConfig => {
  const backendRoot = getBackendRoot();
  return {
    root: process.env.FILE_ROOT
      ? join(process.env.FILE_ROOT)
      : join(backendRoot, 'data') || '',
    maxCount: Number(process.env.UPLOAD_MAX_COUNT ?? 20),
    defaultCategory: process.env.DEFAULT_CATEGORY ?? 'TemporaryFile',
    imageExtensions: [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.webp',
      '.avif',
      '.tiff',
    ],
    uploadTempDir: process.env.UPLOAD_TEMP_DIR
      ? join(process.env.UPLOAD_TEMP_DIR)
      : join(tmpdir(), 'vakao-static-hub', 'uploads'),
    /** 100MB：明显大于默认 5MB 分片，又不会让单块 buffer 吃爆 Node */
    chunkFileSizeLimit: Number(
      process.env.CHUNK_FILE_SIZE_LIMIT ?? 100 * 1024 * 1024,
    ),
  };
});
