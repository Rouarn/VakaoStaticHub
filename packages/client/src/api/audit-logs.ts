/**
 * 审计日志接口与展示字典。
 *
 * 服务端 details 是任意 JSON，这里序列化成字符串交给详情抽屉展示；
 * 动作/资源类型的中文名只在前端维护，后端只存稳定 code。
 */
import type { AuditLog, AuditLogPage, AuditLogQuery } from '@vakao/shared';
import { http } from '@/utils/http';

interface ServerAuditLog {
  id: number;
  userId?: number | null;
  username: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

function toAuditLog(log: ServerAuditLog): AuditLog {
  return {
    id: log.id,
    userId: log.userId ?? null,
    username: log.username || '',
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId ?? null,
    details: log.details ? JSON.stringify(log.details) : null,
    ip: log.ip || null,
    userAgent: log.userAgent || null,
    createdAt: new Date(log.createdAt).getTime(),
  };
}

/**
 * 分页查询审计日志。时间筛选以毫秒传入，转成 RFC 3339；
 * 空字符串筛选条件不会发送，避免服务端把空值当成有效过滤。
 */
export async function listAuditLogs(query: AuditLogQuery) {
  const page = await http.get<{
    items: ServerAuditLog[];
    total: number;
    page: number;
    pageSize: number;
  }>('/audit-logs', {
    ...(query.page ? { page: query.page } : {}),
    ...(query.pageSize ? { pageSize: query.pageSize } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    ...(query.username ? { username: query.username } : {}),
    ...(query.startTime
      ? { startTime: new Date(query.startTime).toISOString() }
      : {}),
    ...(query.endTime
      ? { endTime: new Date(query.endTime).toISOString() }
      : {}),
  });
  return {
    items: page.items.map(toAuditLog),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  } satisfies AuditLogPage;
}

/** 动作中文名：界面展示与筛选用，日志里仍保留原始 code（以 title 呈现） */
export const ACTION_LABELS: Record<string, string> = {
  'user.login': '登录',
  'user.logout': '退出登录',
  'user.register': '创建用户',
  'user.delete': '删除用户',
  'user.change_password': '修改密码',
  'user.reset_password': '重置密码',
  'file.upload': '上传文件',
  'file.delete': '删除文件',
  'file.rename': '重命名文件',
  'file.batch_delete': '批量删除文件',
  'file.batch_move': '批量移动文件',
  'share.create': '创建分享',
  'share.update': '编辑分享',
  'share.revoke': '撤销分享',
  'category.create': '新建分类',
  'category.rename': '重命名分类',
  'category.delete': '删除分类',
  'root.create': '新增资源根',
  'root.update': '编辑资源根',
  'root.delete': '删除资源根',
  'app.create': '创建应用',
  'app.rename': '重命名应用',
  'app.delete': '删除应用',
  'app_version.create': '上传版本',
  'app_version.update': '编辑版本',
  'app_version.publish': '发布版本',
  'app_version.offline': '下架版本',
  'app_version.rollback': '回滚版本',
  'app_version.delete': '删除版本',
  'app_version.force_update': '强更配置',
};

/** 常用动作分组（后端未提供枚举接口，这里按业务模块整理） */
export const ACTION_OPTIONS = [
  'user.login',
  'user.logout',
  'user.register',
  'user.delete',
  'user.change_password',
  'user.reset_password',
  'file.upload',
  'file.delete',
  'file.rename',
  'file.batch_delete',
  'file.batch_move',
  'share.create',
  'share.update',
  'share.revoke',
  'category.create',
  'category.rename',
  'category.delete',
  'root.create',
  'root.update',
  'root.delete',
  'app.create',
  'app.rename',
  'app.delete',
  'app_version.create',
  'app_version.update',
  'app_version.publish',
  'app_version.offline',
  'app_version.rollback',
  'app_version.delete',
  'app_version.force_update',
] as const;

/** 资源类型中文名（与后端 resourceType 取值一一对应） */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  user: '用户',
  file: '文件',
  share: '分享链接',
  app: '应用',
  app_version: '应用版本',
  category: '分类',
  root: '资源根',
};

/** 筛选项：保持与 RESOURCE_TYPE_LABELS 的键一致，顺序用于下拉展示 */
export const RESOURCE_TYPE_OPTIONS = [
  'user',
  'file',
  'share',
  'app',
  'app_version',
  'category',
  'root',
] as const;
