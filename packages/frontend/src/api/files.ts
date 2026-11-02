import type {
  BatchDeleteResult,
  BatchMoveResult,
  ChunkUploadCompleteResult,
  ChunkUploadInitResult,
  DuplicateScanResult,
  FileConfig,
  FileItem,
  PagedResult,
  UsageStatsResult,
} from '@vakao/shared';
import type { RequestOptions } from '@vakao-ui/axios';
import { http, getApiBaseUrl } from '@/utils/http';

/** 路径分段编码：分类与文件名可能含中文/空格，逐段编码后拼回 */
function encodedPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

/** 临时文件区前缀（后端 baseURL = /static） */
function fileBase(rootId: string, category: string, filePath: string): string {
  return `/files/${encodeURIComponent(rootId)}/${encodedPath(category)}/${encodedPath(filePath)}`;
}

/** 文件访问地址（预览 / 下载共用，download=true 强制下载） */
export function getFileUrl(
  rootId: string,
  category: string,
  filePath: string,
  opts: { download?: boolean } = {},
): string {
  const base = `${getApiBaseUrl()}${fileBase(rootId, category, filePath)}`;
  return `${base}${opts.download ? '?download=1' : ''}`;
}

/** 图片缩略图地址（后端 sharp 压缩，卡片网格使用） */
export function getThumbUrl(
  rootId: string,
  category: string,
  filePath: string,
  size = 320,
): string {
  return `${getApiBaseUrl()}${fileBase(rootId, category, filePath)}?w=${size}&h=${size}&format=webp&q=75`;
}

export function getFileConfig() {
  return http.get<FileConfig>('/files/config');
}

export function listCategories(rootId: string) {
  return http.get<string[]>(`/files/${encodeURIComponent(rootId)}/categories`);
}

/** 重命名分类（目录改名，索引与分享链接同事务迁移） */
export function renameCategory(
  rootId: string,
  category: string,
  newCategory: string,
) {
  return http.patch<void>(
    `/files/${encodeURIComponent(rootId)}/categories/${encodedPath(category)}`,
    { newCategory },
  );
}

export interface ListFilesParams {
  page: number;
  pageSize: number;
  q?: string;
  sort?: 'name' | 'size' | 'mtime';
  order?: 'asc' | 'desc';
}

export function listFiles(
  rootId: string,
  category: string,
  params: ListFilesParams,
) {
  return http.get<PagedResult<FileItem>>(
    `/files/${encodeURIComponent(rootId)}/${encodedPath(category)}`,
    params,
  );
}

/**
 * 存储用量统计（分类计数来源）
 *
 * 侧边栏分类面板与存储统计页会同时请求同一路径，客户端对同 key 请求的
 * 后发先至取消策略会让其中一方收到 cancel 并渲染成「请求已取消」错误。
 * 这里共享同一个 in-flight Promise：并发调用者拿到同一份结果，只发一次请求。
 */
let usageInflight: Promise<UsageStatsResult> | null = null;

export function getUsageStats() {
  if (usageInflight) return usageInflight;
  const task = http.get<UsageStatsResult>('/files/stats/usage');
  usageInflight = task;
  const clear = () => {
    if (usageInflight === task) usageInflight = null;
  };
  task.then(clear, clear);
  return task;
}

/** 重复文件检测（按内容 SHA-256 分组；可选限定资源根） */
export function getDuplicateFiles(rootId?: string) {
  return http.get<DuplicateScanResult>(
    '/files/duplicates',
    rootId ? { rootId } : undefined,
  );
}

/** 普通上传（多文件一次请求，受后端上传数量与大小限制约束） */
export function uploadFiles(
  rootId: string,
  category: string,
  files: File[],
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
) {
  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name));
  form.append('category', category);
  const options: RequestOptions = { signal };
  if (onProgress) {
    options.onUploadProgress = (event) => {
      if (event.total)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
  }
  return http.upload<FileItem[]>(
    `/files/${encodeURIComponent(rootId)}/upload`,
    form,
    options,
  );
}

// ==================== 分片上传 ====================

export function initChunkUpload(body: {
  rootId: string;
  category: string;
  filename: string;
  size: number;
  chunkSize: number;
}) {
  return http.post<ChunkUploadInitResult>('/files/upload/init', body);
}

/** 上传单个分片：uploadId / index 走 query，字段名为 chunk */
export function uploadChunk(
  uploadId: string,
  index: number,
  chunk: Blob,
  onProgress?: (loaded: number) => void,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.append('chunk', chunk);
  const options: RequestOptions = { signal };
  if (onProgress) {
    options.onUploadProgress = (event) => onProgress(event.loaded);
  }
  return http.upload<{ index: number; size: number }>(
    `/files/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`,
    form,
    options,
  );
}

export function completeChunkUpload(body: {
  uploadId: string;
  rootId: string;
  category: string;
  filename: string;
  size: number;
}) {
  return http.post<ChunkUploadCompleteResult>('/files/upload/complete', body);
}

export function cancelChunkUpload(uploadId: string) {
  return http.post<{ success: boolean }>('/files/upload/cancel', { uploadId });
}

// ==================== 文件操作 ====================

export function batchDelete(rootId: string, category: string, paths: string[]) {
  return http.post<BatchDeleteResult>('/files/batch-delete', {
    rootId,
    category,
    paths,
  });
}

export function batchMove(
  rootId: string,
  category: string,
  paths: string[],
  targetCategory: string,
) {
  return http.post<BatchMoveResult>('/files/batch-move', {
    rootId,
    category,
    paths,
    targetCategory,
  });
}

export function renameFile(
  rootId: string,
  category: string,
  filePath: string,
  newName: string,
) {
  return http.patch<void>(fileBase(rootId, category, filePath), { newName });
}

export function deleteFile(rootId: string, category: string, filePath: string) {
  return http.delete<{ success: boolean }>(
    fileBase(rootId, category, filePath),
  );
}
