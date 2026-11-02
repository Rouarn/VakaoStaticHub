/**
 * 前后端共享的系统监控指标类型。
 *
 * 对应后端 MetricsService.getMetrics() 的返回结构。
 */

/** 进程内存占用（字节），来自 process.memoryUsage() */
export interface MemoryMetrics {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

/** QPS 滑动窗口指标（最近 N 秒内的请求统计） */
export interface QpsMetrics {
  windowSeconds: number;
  requests: number;
  perSecond: number;
}

/** 单个资源根的存储指标（无文件时 totalSize 为 null，表示“无数据”而非 0 字节） */
export interface RootMetric {
  rootId: string;
  name: string;
  fileCount: number;
  totalSize: number | null;
}

/** 分享链接指标 */
export interface ShareMetrics {
  total: number;
  active: number;
  expired: number;
}

/** 应用版本指标（按状态分组计数） */
export interface AppMetrics {
  total: number;
  published: number;
  draft: number;
  gray: number;
  offline: number;
}

/** 健康检查段：数据库可达性与数据库文件大小（GET /metrics） */
export interface HealthMetrics {
  /** ok 表示关键依赖全部可用 */
  status: 'ok' | 'degraded';
  database: {
    ok: boolean;
    /** sqljs 数据库文件路径 */
    path: string | null;
    /** 数据库文件字节数；文件不存在/不可读时为 null */
    sizeBytes: number | null;
  };
}

/** 系统运行指标（GET /metrics 返回值） */
export interface SystemMetrics {
  /** 进程运行秒数 */
  uptime: number;
  memory: MemoryMetrics;
  qps: QpsMetrics;
  health: HealthMetrics;
  storage: {
    /** 无任何文件索引记录时为 null（区分“无数据”与“0 字节”） */
    totalSize: number | null;
    fileCount: number;
  };
  roots: RootMetric[];
  shares: ShareMetrics;
  apps: AppMetrics;
  /** 最近 24 小时各升级事件类型的数量；无事件时为 null，键始终存在 */
  upgradeEvents24h: Record<string, number | null>;
  users: number;
}
