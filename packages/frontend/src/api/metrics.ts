import type { SidebarCounts, SystemMetrics } from '@vakao/shared';
import { http } from '@/utils/http';

export function getSystemMetrics() {
  return http.get<SystemMetrics>('/metrics');
}

/** 侧栏计数（文件 / 分享）：布局层徽标用，轻量接口 */
export function getSidebarCounts() {
  return http.get<SidebarCounts>('/metrics/sidebar');
}
