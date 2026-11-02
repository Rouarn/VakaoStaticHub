/**
 * 分享域响应映射
 * 收敛 filePaths 解析、shareType/状态派生与对外结构，隔离实体字段与 API 契约
 */

import type {
  ShareAccessLog,
  ShareInfo,
  ShareLink,
  ShareLinkStatus,
} from '@vakao/shared';
import type { ShareAccessLogEntity } from '#/infra/database/entities/share-access-log.entity.js';
import type { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';

/** 读取 filePaths JSON 数组（唯一存储形态，空数组视为数据损坏） */
export function parseFilePaths(filePaths: string): string[] {
  const parsed: unknown = JSON.parse(filePaths);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('share_links.filePaths 数据损坏：期望非空 JSON 数组');
  }
  return parsed as string[];
}

/** 分享类型由路径数量派生，不单独存储 */
export function deriveShareType(filePaths: string[]): 'file' | 'collection' {
  return filePaths.length > 1 ? 'collection' : 'file';
}

/**
 * 状态派生（互斥口径，四种状态之和等于全部）：
 * disabled > expired > exhausted > active
 */
export function deriveShareStatus(
  link: ShareLinkEntity,
  now = Date.now(),
): ShareLinkStatus {
  if (link.enabled === 0) return 'disabled';
  if (link.expiresAt !== null && link.expiresAt <= now) return 'expired';
  if (link.maxAccesses !== null && link.accessCount >= link.maxAccesses) {
    return 'exhausted';
  }
  return 'active';
}

/** 实体 → 管理端列表/详情返回结构 */
export function toShareLink(link: ShareLinkEntity): ShareLink {
  const filePaths = parseFilePaths(link.filePaths);
  return {
    id: link.id,
    token: link.token,
    rootId: link.rootId,
    category: link.category,
    shareType: deriveShareType(filePaths),
    filePaths,
    remark: link.remark,
    enabled: link.enabled !== 0,
    expiresAt: link.expiresAt,
    maxAccesses: link.maxAccesses,
    hasPassword: !!link.passwordHash,
    accessCount: link.accessCount,
    createdAt: link.createdAt,
  };
}

/** 实体 → 公开信息（不返回敏感字段，如 passwordHash） */
export function toShareInfo(link: ShareLinkEntity): ShareInfo {
  const filePaths = parseFilePaths(link.filePaths);
  return {
    token: link.token,
    rootId: link.rootId,
    category: link.category,
    shareType: deriveShareType(filePaths),
    filePaths,
    expiresAt: link.expiresAt,
    maxAccesses: link.maxAccesses,
    hasPassword: !!link.passwordHash,
  };
}

/** 访问日志实体 → 对外结构 */
export function toShareAccessLog(log: ShareAccessLogEntity): ShareAccessLog {
  return {
    id: log.id,
    shareToken: log.shareToken,
    ip: log.ip,
    userAgent: log.userAgent,
    accessedAt: log.accessedAt,
  };
}
