import type { SidebarCounts, SystemMetrics } from '@vakao/shared';
import { http } from '@/utils/http';

interface ServerMetrics {
  version: string;
  uptimeSeconds: number;
  goVersion: string;
  memory: {
    rss: number;
    heapAlloc: number;
    heapSys: number;
    sys: number;
  };
  qps: number;
  database: {
    path: string;
    size: number;
    walSize: number;
  };
  storage: {
    fileRoot: string;
    fileCount: number;
    totalSize: number;
  };
  counts: {
    users: number;
    files: number;
    shares: number;
    appVersions: number;
    upgradeEvents: number;
    auditLogs: number;
  };
  roots: Array<{
    rootId: string;
    rootName: string;
    fileCount: number;
    totalSize: number;
  }>;
  shares: { total: number; active: number; expired: number };
  apps: {
    total: number;
    draft: number;
    gray: number;
    published: number;
    offline: number;
  };
  upgradeEvents24h: Record<string, number>;
}

const UPGRADE_EVENTS = [
  'check_no_update',
  'prompt_show',
  'download_start',
  'download_success',
  'download_fail',
  'verify_fail',
  'install_success',
  'install_fail',
  'new_version_launch',
] as const;

export async function getSystemMetrics() {
  const metrics = await http.get<ServerMetrics>('/metrics');
  const perSecond = Math.round(metrics.qps * 100) / 100;
  return {
    uptime: metrics.uptimeSeconds,
    memory: {
      rss: metrics.memory.rss,
      heapTotal: metrics.memory.heapSys,
      heapUsed: metrics.memory.heapAlloc,
      external: metrics.memory.sys,
    },
    qps: {
      windowSeconds: 60,
      requests: Math.round(perSecond * 60),
      perSecond,
    },
    health: {
      status: 'ok',
      database: {
        ok: true,
        path: metrics.database.path || null,
        sizeBytes: metrics.database.size || null,
      },
    },
    storage: {
      totalSize:
        metrics.storage.fileCount > 0 ? metrics.storage.totalSize : null,
      fileCount: metrics.storage.fileCount,
    },
    roots: metrics.roots.map((root) => ({
      rootId: root.rootId,
      name: root.rootName,
      fileCount: root.fileCount,
      totalSize: root.fileCount > 0 ? root.totalSize : null,
    })),
    shares: metrics.shares,
    apps: metrics.apps,
    upgradeEvents24h: Object.fromEntries(
      UPGRADE_EVENTS.map((event) => [
        event,
        metrics.upgradeEvents24h[event] ?? null,
      ]),
    ),
    users: metrics.counts.users,
  } satisfies SystemMetrics;
}

/** 侧栏计数（文件 / 分享）：布局层徽标用，轻量接口 */
export function getSidebarCounts() {
  return http.get<SidebarCounts>('/metrics/sidebar');
}
