import type { AuditLogPage, AuditLogQuery } from '@vakao/shared';
import { http } from '@/utils/http';

export function listAuditLogs(query: AuditLogQuery) {
  return http.get<AuditLogPage>('/audit-logs', query);
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
  'app.create': '创建应用',
  'app.rename': '重命名应用',
  'app.delete': '删除应用',
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
  'app.create',
  'app.rename',
  'app.delete',
  'app_version.publish',
  'app_version.offline',
  'app_version.rollback',
  'app_version.delete',
  'app_version.force_update',
] as const;

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  user: '用户',
  file: '文件',
  share: '分享链接',
  app: '应用',
  app_version: '应用版本',
  category: '分类',
};

export const RESOURCE_TYPE_OPTIONS = [
  'user',
  'file',
  'share',
  'app',
  'app_version',
  'category',
] as const;
