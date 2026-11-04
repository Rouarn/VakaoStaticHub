/**
 * 监控指标服务
 * 聚合系统运行指标：进程状态、存储用量、分享链接、应用版本、升级事件与 QPS
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { stat } from 'node:fs/promises';
import { Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import {
  AppVersionEntity,
  VERSION_STATUS,
} from '#/infra/database/entities/app-version.entity.js';
import { AppUpgradeEventEntity } from '#/infra/database/entities/app-upgrade-event.entity.js';
import { UserEntity } from '#/infra/database/entities/user.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import { UPGRADE_EVENTS } from '../app-update/dto/report-event.dto.js';
import type {
  SystemMetrics,
  QpsMetrics,
  RootMetric,
  ShareMetrics,
  AppMetrics,
  HealthMetrics,
  SidebarCounts,
} from '@vakao/shared';

/** QPS 滑动窗口长度（毫秒），统计最近 60 秒内的请求数 */
const QPS_WINDOW_MS = 60_000;

/** 升级事件统计的时间范围：最近 24 小时 */
const UPGRADE_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 各资源根的聚合行（file_entries 按 rootId 分组） */
interface RawRootRow {
  rootId: string;
  fileCount: string | number;
  totalSize: string | number | null;
}

/** 应用版本按状态分组的聚合行 */
interface RawStatusRow {
  status: string | number;
  count: string | number;
}

/** 升级事件按类型分组的聚合行 */
interface RawEventRow {
  event: string;
  count: string | number;
}

@Injectable()
export class MetricsService {
  /** 请求时间戳滑动窗口（内存计数器，进程重启即清零） */
  private requestTimestamps: number[] = [];

  constructor(
    @InjectRepository(FileEntryEntity)
    private readonly fileRepo: Repository<FileEntryEntity>,
    @InjectRepository(ShareLinkEntity)
    private readonly shareRepo: Repository<ShareLinkEntity>,
    @InjectRepository(AppVersionEntity)
    private readonly versionRepo: Repository<AppVersionEntity>,
    @InjectRepository(AppUpgradeEventEntity)
    private readonly eventRepo: Repository<AppUpgradeEventEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly resourceRootsService: ResourceRootsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 记录一次请求（由全局拦截器调用）
   * 同时清理窗口外的过期时间戳，防止数组无限增长
   */
  recordRequest() {
    const now = Date.now();
    this.requestTimestamps.push(now);
    this.pruneTimestamps(now);
  }

  /** 获取 QPS 指标：最近 60 秒内的请求数与平均每秒请求数 */
  getQps(): QpsMetrics {
    const now = Date.now();
    this.pruneTimestamps(now);
    const requests = this.requestTimestamps.length;
    return {
      windowSeconds: QPS_WINDOW_MS / 1000,
      requests,
      perSecond: Number((requests / (QPS_WINDOW_MS / 1000)).toFixed(2)),
    };
  }

  /** 清理滑动窗口中超出时间范围的时间戳 */
  private pruneTimestamps(now: number) {
    const cutoff = now - QPS_WINDOW_MS;
    // 时间戳按时间顺序入队，从头部移除过期项即可
    while (
      this.requestTimestamps.length > 0 &&
      this.requestTimestamps[0] < cutoff
    ) {
      this.requestTimestamps.shift();
    }
  }

  /** 汇总全部监控指标 */
  async getMetrics(): Promise<SystemMetrics> {
    const [storage, roots, shares, apps, upgradeEvents24h, users, health] =
      await Promise.all([
        this.getStorageMetrics(),
        this.getRootMetrics(),
        this.getShareMetrics(),
        this.getAppMetrics(),
        this.getUpgradeEventMetrics(),
        this.userRepo.count(),
        this.getHealthMetrics(),
      ]);

    const { rss, heapTotal, heapUsed, external } = process.memoryUsage();

    return {
      /** 进程运行秒数 */
      uptime: Math.floor(process.uptime()),
      /** 进程内存占用（字节） */
      memory: { rss, heapTotal, heapUsed, external },
      /** QPS 内存计数器（最近 60 秒滑动窗口） */
      qps: this.getQps(),
      health,
      storage,
      roots,
      shares,
      apps,
      upgradeEvents24h,
      users,
    };
  }

  /**
   * 健康检查段：数据库可达性 + 数据库文件大小
   * 数据库文件是 better-sqlite3 持久化目标，未配置路径或文件不可读时 sizeBytes 为 null
   */
  private async getHealthMetrics(): Promise<HealthMetrics> {
    const dbPath = this.configService.get<string>('db.path') ?? null;

    let ok = true;
    try {
      await this.fileRepo.query('SELECT 1');
    } catch {
      ok = false;
    }

    let sizeBytes: number | null = null;
    if (dbPath) {
      try {
        const info = await stat(dbPath);
        sizeBytes = info.isFile() ? info.size : null;
      } catch {
        // 数据库尚未落盘（首次启动写入前）或路径不可读，明确返回 null
        sizeBytes = null;
      }
    }

    return {
      status: ok ? 'ok' : 'degraded',
      database: { ok, path: dbPath, sizeBytes },
    };
  }

  /** 存储总量：file_entries 的文件数与总大小（无索引记录时 totalSize 为 null） */
  private async getStorageMetrics(): Promise<{
    totalSize: number | null;
    fileCount: number;
  }> {
    const raw = await this.fileRepo
      .createQueryBuilder('f')
      .select('COUNT(*)', 'fileCount')
      .addSelect('COALESCE(SUM(f.size), 0)', 'totalSize')
      .getRawOne<{ fileCount: string | number; totalSize: string | number }>();

    const fileCount = Number(raw?.fileCount) || 0;
    return {
      // 无索引记录表示“无数据”，不能等同于 0 字节
      totalSize: fileCount > 0 ? Number(raw?.totalSize) || 0 : null,
      fileCount,
    };
  }

  /** 各资源根的文件数与大小（包含零文件的资源根，无文件时 totalSize 为 null） */
  private async getRootMetrics(): Promise<RootMetric[]> {
    const rows = await this.fileRepo
      .createQueryBuilder('f')
      .select('f.rootId', 'rootId')
      .addSelect('COUNT(*)', 'fileCount')
      .addSelect('COALESCE(SUM(f.size), 0)', 'totalSize')
      .groupBy('f.rootId')
      .getRawMany<RawRootRow>();

    const statMap = new Map(
      rows.map((r) => {
        const fileCount = Number(r.fileCount) || 0;
        return [
          r.rootId,
          {
            fileCount,
            totalSize: fileCount > 0 ? Number(r.totalSize) || 0 : null,
          },
        ] as const;
      }),
    );

    // 以资源配置为准合并统计，保证无文件的资源根也会出现
    return this.resourceRootsService.getRoots().map((root) => ({
      rootId: root.id,
      name: root.name,
      fileCount: statMap.get(root.id)?.fileCount ?? 0,
      totalSize: statMap.get(root.id)?.totalSize ?? null,
    }));
  }

  /** 侧栏计数：文件索引总数 + 分享链接总数（两条 COUNT，避免拉取完整指标） */
  async getSidebarCounts(): Promise<SidebarCounts> {
    const [files, shares] = await Promise.all([
      this.fileRepo.count(),
      this.shareRepo.count(),
    ]);
    return { files, shares };
  }

  /** 分享链接统计：总数 / 活跃数 / 已过期数（含过期时间与访问次数两种失效方式） */
  private async getShareMetrics(): Promise<ShareMetrics> {
    const now = Date.now();
    const total = await this.shareRepo.count();
    const expired = await this.shareRepo
      .createQueryBuilder('s')
      .where('(s.expiresAt IS NOT NULL AND s.expiresAt <= :now)', { now })
      .orWhere('(s.maxAccesses IS NOT NULL AND s.accessCount >= s.maxAccesses)')
      .getCount();

    return { total, active: total - expired, expired };
  }

  /** 应用版本统计：按状态分组（草稿 / 灰度 / 全量 / 已下架） */
  private async getAppMetrics(): Promise<AppMetrics> {
    const rows = await this.versionRepo
      .createQueryBuilder('v')
      .select('v.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('v.status')
      .getRawMany<RawStatusRow>();

    const countByStatus = new Map(
      rows.map((r) => [Number(r.status), Number(r.count) || 0]),
    );

    const draft = countByStatus.get(VERSION_STATUS.DRAFT) ?? 0;
    const gray = countByStatus.get(VERSION_STATUS.GRAY) ?? 0;
    const published = countByStatus.get(VERSION_STATUS.PUBLISHED) ?? 0;
    const offline = countByStatus.get(VERSION_STATUS.OFFLINE) ?? 0;

    return {
      total: draft + gray + published + offline,
      published,
      draft,
      gray,
      offline,
    };
  }

  /** 最近 24 小时各升级事件类型的数量；无事件的类型返回 null（键始终存在） */
  private async getUpgradeEventMetrics(): Promise<
    Record<string, number | null>
  > {
    const since = Date.now() - UPGRADE_EVENT_WINDOW_MS;
    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.event', 'event')
      .addSelect('COUNT(*)', 'count')
      .where('e.createdAt >= :since', { since })
      .groupBy('e.event')
      .getRawMany<RawEventRow>();

    const result: Record<string, number | null> = {};
    // 预填全部已知事件为 null，避免前端把“无数据”误读成 0 次
    for (const event of UPGRADE_EVENTS) {
      result[event] = null;
    }
    for (const row of rows) {
      result[row.event] = Number(row.count) || 0;
    }
    return result;
  }
}
