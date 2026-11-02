/**
 * 前后端共享的文件管理响应类型。
 *
 * 对应后端 FilesService 中用量统计、重复检测、分片上传、批量操作等方法的返回结构。
 */

/** 存储用量统计：单个分类 */
export interface UsageCategory {
  category: string;
  totalSize: number;
  fileCount: number;
}

/** 存储用量统计：单个资源根 */
export interface UsageRoot {
  rootId: string;
  rootName: string;
  totalSize: number;
  fileCount: number;
  categories: UsageCategory[];
}

/** 存储用量统计返回值（GET /files/stats/usage） */
export interface UsageStatsResult {
  roots: UsageRoot[];
  totalSize: number;
  fileCount: number;
}

/** 重复文件组中的单个文件 */
export interface DuplicateFileItem {
  rootId: string;
  category: string;
  relPath: string;
  name: string;
  size: number;
  mtime: number;
}

/** 内容哈希相同的重复文件组 */
export interface DuplicateGroup {
  contentHash: string;
  size: number;
  count: number;
  files: DuplicateFileItem[];
}

/** 重复文件检测返回值（GET /files/duplicates） */
export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  groupCount: number;
  duplicateFileCount: number;
  /** 本次扫描惰性补算哈希的文件数 */
  hashedCount: number;
}

/** 分片上传初始化返回值（POST /files/upload/init） */
export interface ChunkUploadInitResult {
  uploadId: string;
  chunkSize: number;
  uploadedChunks: number[];
}

/** 分片上传完成返回值（POST /files/upload/complete） */
export interface ChunkUploadCompleteResult {
  name: string;
  path: string;
  size: number;
  mtime: number;
  /** 合并后文件的 SHA-256 摘要（hex，64 小写字符），供前端与本地哈希做完整性校验 */
  contentHash: string;
}

/** 批量删除返回值 */
export interface BatchDeleteResult {
  deletedCount: number;
}

/** 批量移动单条结果 */
export interface BatchMoveResultItem {
  path: string;
  success: boolean;
  error?: string;
}

/** 批量移动返回值 */
export interface BatchMoveResult {
  results: BatchMoveResultItem[];
  movedCount: number;
}
