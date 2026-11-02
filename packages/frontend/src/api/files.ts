import { request } from '../utils/request';
import type { RequestOptions } from '@vakao-ui/axios';
import type {
  ResourceRoot,
  FileItem,
  FileConfig,
  PagedResult,
  UsageStatsResult,
  DuplicateScanResult,
  ChunkUploadInitResult,
  ChunkUploadCompleteResult,
  BatchDeleteResult,
  BatchMoveResult,
} from '@vakao/shared';

export function getRoots() {
  return request.get<ResourceRoot[]>('/roots');
}

export function addRoot(root: ResourceRoot) {
  return request.post<ResourceRoot[]>('/roots', root);
}

export function updateRoot(
  id: string,
  root: Partial<Omit<ResourceRoot, 'id'>>,
) {
  return request.patch<ResourceRoot[]>(`/roots/${id}`, root);
}

export function removeRoot(id: string) {
  return request.delete<{ success: true }>(`/roots/${id}`);
}

export function getFileConfig() {
  return request.get<FileConfig>('/files/config');
}

export function getCategories(rootId: string) {
  return request.get<string[]>(`/files/${rootId}/categories`);
}

export function renameCategory(
  rootId: string,
  category: string,
  newCategory: string,
) {
  return request.patch<{ category: string }>(
    `/files/${rootId}/categories/${encodeURIComponent(category)}`,
    { newCategory },
  );
}

export function getFiles(
  rootId: string,
  category: string,
  params: {
    page: number;
    pageSize: number;
    q?: string;
    sort?: string;
    order?: string;
  },
) {
  return request.get<PagedResult<FileItem>>(
    `/files/${rootId}/${encodeURIComponent(category)}`,
    params,
  );
}

export function getUsageStats() {
  return request.get<UsageStatsResult>('/files/stats/usage');
}

export function getDuplicates(rootId?: string) {
  return request.get<DuplicateScanResult>(
    '/files/duplicates',
    rootId ? { rootId } : undefined,
  );
}

export interface UploadOptions {
  onUploadProgress?: RequestOptions['onUploadProgress'];
}

export function uploadFile(
  rootId: string,
  category: string,
  file: File,
  options?: UploadOptions,
) {
  const fd = new FormData();
  fd.append('files', file);
  fd.append('category', category);
  return request.upload(`/files/${rootId}/upload`, fd, {
    // 上传具有副作用，禁用重复请求取消，避免同名文件并发上传被误取消
    dedupe: false,
    onUploadProgress: options?.onUploadProgress,
  });
}

// ==================== 大文件分片上传 ====================

export function initChunkUpload(
  rootId: string,
  category: string,
  filename: string,
  size: number,
  chunkSize: number,
) {
  return request.post<ChunkUploadInitResult>('/files/upload/init', {
    rootId,
    category,
    filename,
    size,
    chunkSize,
  });
}

export function uploadChunk(uploadId: string, index: number, chunk: Blob) {
  const fd = new FormData();
  fd.append('chunk', chunk);
  return request.upload(
    `/files/upload/chunk?uploadId=${uploadId}&index=${index}`,
    fd,
    { dedupe: false },
  );
}

export function completeChunkUpload(
  uploadId: string,
  rootId: string,
  category: string,
  filename: string,
  size: number,
) {
  return request.post<ChunkUploadCompleteResult>('/files/upload/complete', {
    uploadId,
    rootId,
    category,
    filename,
    size,
  });
}

export function cancelChunkUpload(uploadId: string) {
  return request.post<{ success: boolean }>('/files/upload/cancel', {
    uploadId,
  });
}

export function batchDeleteFiles(
  rootId: string,
  category: string,
  paths: string[],
) {
  return request.post<BatchDeleteResult>('/files/batch-delete', {
    rootId,
    category,
    paths,
  });
}

export function batchMoveFiles(
  rootId: string,
  category: string,
  paths: string[],
  targetCategory: string,
) {
  return request.post<BatchMoveResult>('/files/batch-move', {
    rootId,
    category,
    paths,
    targetCategory,
  });
}

export function deleteFile(rootId: string, category: string, path: string) {
  const encodedCategory = encodeURIComponent(category);
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return request.delete<null>(
    `/files/${rootId}/${encodedCategory}/${encodedPath}`,
  );
}

export function renameFile(
  rootId: string,
  category: string,
  path: string,
  newName: string,
) {
  const encodedCategory = encodeURIComponent(category);
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return request.patch<FileItem>(
    `/files/${rootId}/${encodedCategory}/${encodedPath}`,
    { newName },
  );
}

export function syncFileIndex() {
  return request.post<{ message: string }>('/files/sync');
}

export function getSystemDirectories(path?: string) {
  return request.get<any[]>(
    '/roots/system/directories',
    path ? { path } : undefined,
  );
}
