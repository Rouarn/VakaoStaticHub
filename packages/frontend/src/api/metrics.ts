import type { SystemMetrics } from '@vakao/shared';
import { http } from '@/utils/http';

export function getSystemMetrics() {
  return http.get<SystemMetrics>('/metrics');
}
