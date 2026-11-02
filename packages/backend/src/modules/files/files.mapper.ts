/**
 * 文件域响应映射
 * 把索引实体转换为对外响应结构，隔离数据库字段与 API 契约
 */

import type { DuplicateFileItem, DuplicateGroup } from '@vakao/shared';
import type { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';

/** 文件列表项（GET /files/:rootId/:category） */
export interface FileListItem {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

/**
 * 索引记录 → 文件列表项
 * 分类为嵌套路径时，对外路径需去掉分类后缀前缀
 */
export function toFileListItem(
  row: FileEntryEntity,
  relPathSuffix = '',
): FileListItem {
  let relativePath = row.relPath;
  if (relPathSuffix && relativePath.startsWith(relPathSuffix + '/')) {
    relativePath = relativePath.substring(relPathSuffix.length + 1);
  }
  return {
    name: row.name,
    path: relativePath,
    size: row.size,
    mtime: row.mtimeMs,
  };
}

/** 索引记录 → 重复文件组中的单项 */
export function toDuplicateFileItem(row: FileEntryEntity): DuplicateFileItem {
  return {
    rootId: row.rootId,
    category: row.category,
    relPath: row.relPath,
    name: row.name,
    size: row.size,
    mtime: row.mtimeMs,
  };
}

/** 同内容哈希的索引记录 → 重复文件组 */
export function toDuplicateGroup(
  contentHash: string,
  rows: FileEntryEntity[],
): DuplicateGroup {
  return {
    contentHash,
    size: rows[0]?.size ?? 0,
    count: rows.length,
    files: rows.map(toDuplicateFileItem),
  };
}
