import type { AuditLogPage, AuditLogQuery } from '@vakao/shared';
import { http } from '@/utils/http';

export function listAuditLogs(query: AuditLogQuery) {
  return http.get<AuditLogPage>('/audit-logs', query);
}

/** 常用动作分组（后端未提供枚举接口，这里按业务模块整理） */
export const ACTION_OPTIONS = [
  'user.login',
  'user.logout',
  'user.register',
  'user.delete',
  'user.change_password',
  'file.upload',
  'file.delete',
  'file.rename',
  'file.batch_delete',
  'file.batch_move',
  'share.create',
  'share.revoke',
  'app.create',
  'app.rename',
  'app.delete',
  'app_version.publish',
  'app_version.offline',
  'app_version.rollback',
  'app_version.delete',
  'app_version.force_update',
] as const;

export const RESOURCE_TYPE_OPTIONS = [
  'user',
  'file',
  'share',
  'app',
  'app_version',
] as const;
