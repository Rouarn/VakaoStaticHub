import { request } from '../utils/request';
import type { AuditLogQuery, AuditLogPage, SystemMetrics } from '@vakao/shared';

/** 分页查询操作审计日志 */
export function getAuditLogs(params: AuditLogQuery) {
  return request.get<AuditLogPage>('/audit-logs', params);
}

/** 获取系统运行指标 */
export function getSystemMetrics() {
  return request.get<SystemMetrics>('/metrics');
}

export type {
  AuditLog,
  AuditLogQuery,
  AuditLogPage,
  SystemMetrics,
} from '@vakao/shared';
