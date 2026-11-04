/**
 * 路径工具函数模块
 * 提供安全路径操作、路径规范化和文件扩展名提取等功能
 * 防止路径穿越攻击，确保文件系统操作的安全性
 */

import { isAbsolute, normalize, resolve, sep } from 'path';
import { getBackendRoot } from './backend-root.util.js';

/**
 * 安全路径拼接函数
 * 防止路径穿越攻击（Path Traversal Attack）
 *
 * @param rootPath 根路径，所有拼接结果必须在此目录下
 * @param parts 路径片段数组
 * @returns 拼接后的绝对路径
 * @throws Error 如果拼接结果超出根路径范围
 */
export function safeJoin(rootPath: string, parts: string[]): string {
  // 将根路径解析为绝对路径
  const resolvedRoot = isAbsolute(rootPath)
    ? rootPath
    : resolve(getBackendRoot(), rootPath);

  // 拼接目标路径
  const target = resolve(resolvedRoot, ...parts);

  // 标准化路径（移除 ../ 和 ./）
  const normalizedRoot = normalize(resolvedRoot + sep);
  const normalizedTarget = normalize(target + sep);

  // 验证目标路径是否在根路径范围内
  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error('Invalid path');
  }

  return target;
}

/**
 * 规范化类别路径
 * 处理嵌套路径（如 "Wallpapers/Nature"）为数据库存储格式
 *
 * @param category 类别路径，支持嵌套格式如 "category/subcategory"
 * @returns 包含数据库类别名和相对路径后缀的对象
 *
 * @example
 * normalizeCategoryPath('Wallpapers')
 * // => { dbCategory: 'Wallpapers', relPathSuffix: '' }
 *
 * @example
 * normalizeCategoryPath('Wallpapers/Nature/Summer')
 * // => { dbCategory: 'Wallpapers', relPathSuffix: 'Nature/Summer' }
 */
export function normalizeCategoryPath(category: string): {
  dbCategory: string;
  relPathSuffix: string;
} {
  // 标准化路径，将反斜杠统一为正斜杠
  const normalized = normalize(category).replace(/\\/g, '/');

  // 按斜杠分割路径，过滤空字符串和当前目录
  const parts = normalized.split('/').filter((p) => p && p !== '.');

  // 处理空路径情况
  if (parts.length === 0) {
    return { dbCategory: '', relPathSuffix: '' };
  }

  // 处理单级路径
  if (parts.length === 1) {
    return { dbCategory: parts[0], relPathSuffix: '' };
  }

  // 处理嵌套路径：第一级为数据库类别，剩余部分为相对路径后缀
  return {
    dbCategory: parts[0],
    relPathSuffix: parts.slice(1).join('/'),
  };
}

/**
 * 提取文件扩展名
 * 返回小写的扩展名，包含点号
 *
 * @param filename 文件名
 * @returns 文件扩展名（如 ".jpg"），无扩展名返回空字符串
 *
 * @example
 * getFileExtension('image.jpg') // => '.jpg'
 * @example
 * getFileExtension('document') // => ''
 * @example
 * getFileExtension('archive.tar.gz') // => '.gz'
 */
export function getFileExtension(filename: string): string {
  const ext = filename.includes('.')
    ? `.${filename.split('.').pop()}`.toLowerCase()
    : '';
  return ext;
}

/**
 * 分片上传 uploadId 合法格式正则
 * 收敛为唯一权威常量：files.service.ts 生成校验、cleanup.service.ts 清理识别
 * 都引用这同一个正则，避免以后改生成策略时三处漂移。
 */
export const UPLOAD_ID_REGEX = /^[a-f0-9]{32}$/;
