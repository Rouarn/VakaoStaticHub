import type {
  BatchDeleteResult,
  BatchMoveResult,
  ChunkUploadCompleteResult,
  ChunkUploadInitResult,
  DuplicateFilesQuery,
  DuplicateScanResult,
  FileConfig,
  FileItem,
  PagedResult,
  UsageCategory,
  UsageRoot,
  UsageStatsResult,
} from '@vakao/shared';
import type { RequestOptions } from '@vakao-ui/axios';
import { http } from '@/utils/http';

interface ServerFileEntry {
  id: number;
  rootId: string;
  category: string;
  relPath: string;
  name: string;
  extension: string;
  size: number;
  mtime: string;
  contentHash?: string;
  url: string;
}

interface ServerPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface ServerCategoryInfo {
  name: string;
  fileCount: number;
  totalSize: number;
}

interface ServerStorageStat {
  rootId: string;
  rootName: string;
  category: string;
  fileCount: number;
  totalSize: number;
}

function toFileItem(entry: ServerFileEntry): FileItem {
  return {
    name: entry.name,
    path: entry.relPath,
    size: entry.size,
    mtime: new Date(entry.mtime).getTime(),
  };
}

export function getFileConfig() {
  return http.get<FileConfig>('/files/config');
}

export async function listCategories(rootId: string) {
  const items = await http.get<ServerCategoryInfo[]>('/files/categories', {
    rootId,
  });
  return items.map((item) => item.name);
}

/** 新建空分类（根目录下的一级子目录） */
export async function createCategory(rootId: string, name: string) {
  const created = await http.post<{ name: string }>('/files/categories', {
    rootId,
    name,
  });
  return { category: created.name };
}

/**
 * 删除分类
 * - 默认仅允许删除空分类，非空会返回 409
 * - recursive=true 时连同分类内文件索引、分享链接与磁盘文件一并删除
 */
export async function deleteCategory(
  rootId: string,
  category: string,
  recursive = false,
) {
  await http.delete('/files/categories', {
    rootId,
    name: category,
    ...(recursive ? { recursive: '1' } : {}),
  });
  return { success: true, removedEntries: 0 };
}

/** 重命名分类（目录改名，索引与分享链接同事务迁移） */
export async function renameCategory(
  rootId: string,
  category: string,
  newCategory: string,
) {
  await http.patch<void>('/files/categories', {
    rootId,
    name: category,
    newName: newCategory,
  });
}

export interface ListFilesParams {
  page: number;
  pageSize: number;
  q?: string;
  sort?: 'name' | 'size' | 'mtime';
  order?: 'asc' | 'desc';
}

export async function listFiles(
  rootId: string,
  category: string,
  params: ListFilesParams,
) {
  const page = await http.get<ServerPage<ServerFileEntry>>('/files', {
    rootId,
    category,
    ...params,
  });
  return {
    items: page.items.map(toFileItem),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  } satisfies PagedResult<FileItem>;
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
  const task = http
    .get<ServerStorageStat[]>('/files/stats')
    .then((stats) => groupUsageStats(stats));
  usageInflight = task;
  const clear = () => {
    if (usageInflight === task) usageInflight = null;
  };
  task.then(clear, clear);
  return task;
}

function groupUsageStats(stats: ServerStorageStat[]): UsageStatsResult {
  const roots: UsageRoot[] = [];
  const byRoot = new Map<string, UsageRoot>();
  let totalSize = 0;
  let fileCount = 0;

  for (const stat of stats) {
    let root = byRoot.get(stat.rootId);
    if (!root) {
      root = {
        rootId: stat.rootId,
        rootName: stat.rootName,
        totalSize: 0,
        fileCount: 0,
        categories: [],
      };
      byRoot.set(stat.rootId, root);
      roots.push(root);
    }
    const category: UsageCategory = {
      category: stat.category,
      totalSize: stat.totalSize,
      fileCount: stat.fileCount,
    };
    root.categories.push(category);
    root.totalSize += stat.totalSize;
    root.fileCount += stat.fileCount;
    totalSize += stat.totalSize;
    fileCount += stat.fileCount;
  }

  return { roots, totalSize, fileCount };
}

/** 重复文件检测（按内容 SHA-256 分组；服务端分页） */
export async function getDuplicateFiles(params: DuplicateFilesQuery = {}) {
  const page = await http.get<
    ServerPage<{
      hash: string;
      size: number;
      count: number;
      files: Array<{
        rootId: string;
        category: string;
        relPath: string;
        name: string;
        size: number;
        mtime: string;
      }>;
    }>
  >('/files/duplicates', {
    ...(params.rootId ? { rootId: params.rootId } : {}),
    ...(params.page ? { page: params.page } : {}),
    ...(params.pageSize ? { pageSize: params.pageSize } : {}),
  });

  const groups = page.items.map((group) => ({
    contentHash: group.hash,
    size: group.size,
    count: group.count,
    files: group.files.map((file) => ({
      rootId: file.rootId,
      category: file.category,
      relPath: file.relPath,
      name: file.name,
      size: file.size,
      mtime: new Date(file.mtime).getTime(),
    })),
  }));

  return {
    groups,
    groupCount: page.total,
    duplicateFileCount: groups.reduce(
      (sum, group) => sum + group.files.length,
      0,
    ),
    hashedCount: 0,
    page: page.page,
    pageSize: page.pageSize,
  } satisfies DuplicateScanResult;
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
  const options: RequestOptions = { signal };
  if (onProgress) {
    options.onUploadProgress = (event) => {
      if (event.total)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
  }
  return http
    .upload<{
      uploaded: ServerFileEntry[];
      failed: Array<{ name: string; error: string }>;
    }>(
      `/files/upload?rootId=${encodeURIComponent(rootId)}&category=${encodeURIComponent(category)}`,
      form,
      options,
    )
    .then((result) => result.uploaded.map(toFileItem));
}

// ==================== 分片上传 ====================

export function initChunkUpload(body: {
  rootId: string;
  category: string;
  filename: string;
  size: number;
  chunkSize: number;
}) {
  return http.post<ChunkUploadInitResult>('/uploads', body);
}

/** 上传单个分片：请求体为原始二进制，uploadId / index 走路径 */
export function uploadChunk(
  uploadId: string,
  index: number,
  chunk: Blob,
  onProgress?: (loaded: number) => void,
  signal?: AbortSignal,
) {
  const options: RequestOptions = {
    signal,
    headers: { 'Content-Type': 'application/octet-stream' },
  };
  if (onProgress) {
    options.onUploadProgress = (event) => onProgress(event.loaded);
  }
  return http.put<unknown>(
    `/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
    chunk,
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
  return http
    .post<ServerFileEntry>(
      `/uploads/${encodeURIComponent(body.uploadId)}/complete`,
      {
        rootId: body.rootId,
        category: body.category,
        filename: body.filename,
        size: body.size,
      },
    )
    .then(
      (entry) =>
        ({
          name: entry.name,
          path: entry.relPath,
          size: entry.size,
          mtime: new Date(entry.mtime).getTime(),
          contentHash: entry.contentHash ?? '',
        }) satisfies ChunkUploadCompleteResult,
    );
}

export async function cancelChunkUpload(uploadId: string) {
  await http.delete(`/uploads/${encodeURIComponent(uploadId)}`);
  return { success: true };
}

/** 强制重建文件索引：重扫磁盘并刷新数据库 */
export async function syncFileIndex() {
  const result = await http.post<{
    indexed: number;
    removed: number;
    durationMs: number;
  }>('/files/index', {});
  return {
    message: `索引完成：新增 ${result.indexed} 条，移除 ${result.removed} 条，耗时 ${result.durationMs}ms`,
  };
}

// ==================== 文件操作 ====================

export async function batchDelete(
  rootId: string,
  category: string,
  paths: string[],
) {
  const result = await http.post<{ deleted: number }>('/files/batch-delete', {
    rootId,
    category,
    paths,
  });
  return { deletedCount: result.deleted } satisfies BatchDeleteResult;
}

export async function batchMove(
  rootId: string,
  category: string,
  paths: string[],
  targetCategory: string,
) {
  const result = await http.post<{ moved: number }>('/files/batch-move', {
    rootId,
    category,
    paths,
    targetCategory,
  });
  return {
    movedCount: result.moved,
    results: paths.map((path) => ({ path, success: true, error: undefined })),
  } satisfies BatchMoveResult;
}

export async function renameFile(
  rootId: string,
  category: string,
  filePath: string,
  newName: string,
) {
  await http.patch<void>('/files/rename', {
    rootId,
    category,
    path: filePath,
    newName,
  });
}

export async function deleteFile(
  rootId: string,
  category: string,
  filePath: string,
) {
  await http.delete('/files', { rootId, category, path: filePath });
  return { success: true };
}
