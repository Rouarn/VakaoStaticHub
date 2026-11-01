import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { In, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';

type FileRecord = Omit<FileEntryEntity, 'id'>;

@Injectable()
export class FileIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FileIndexService.name);
  private readonly syncIntervalName = 'file-index-sync';

  constructor(
    private readonly resourceRoots: ResourceRootsService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(FileEntryEntity)
    private readonly repo: Repository<FileEntryEntity>,
  ) {}

  async onApplicationBootstrap() {
    await this.syncAll();

    const interval =
      this.configService.get<number>('schedule.cacheRefreshInterval') ?? 300000;
    const callback = () => {
      void this.syncAll();
    };
    const intervalId = setInterval(callback, interval);
    this.schedulerRegistry.addInterval(this.syncIntervalName, intervalId);
    this.logger.log(`File index sync scheduled every ${interval}ms`);
  }

  async syncAll() {
    const roots = this.resourceRoots.getRoots();

    const activeRootIds = roots.map((r) => r.id);
    if (activeRootIds.length > 0) {
      await this.repo.delete({ rootId: Not(In(activeRootIds)) });
    } else {
      await this.repo.clear();
    }

    for (const root of roots) {
      await this.syncRoot(root.id);
    }
  }

  @OnEvent('resource.updated')
  async handleResourceUpdated() {
    await this.syncAll();
  }

  async syncRoot(rootId: string) {
    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    let categories: string[];
    try {
      await mkdir(rootPath, { recursive: true });
      categories = (await readdir(rootPath, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch (error) {
      if (!this.isSkippableError(error)) throw error;
      // 整个根目录不可读：保留上一轮索引，跳过本轮同步，避免影响服务启动
      this.logger.warn(`跳过无权限读取的资源根目录：${rootPath}`);
      return;
    }

    // 全量重建前先快照已有 contentHash：文件大小与修改时间均未变化时
    // 内容必然未变，可直接保留哈希，避免每次定时同步后重复文件检测都要重新扫盘
    const existing = await this.repo.find({
      where: { rootId },
      select: {
        category: true,
        relPath: true,
        size: true,
        mtimeMs: true,
        contentHash: true,
      },
    });
    const hashMap = new Map<string, string>();
    for (const row of existing) {
      if (row.contentHash) {
        hashMap.set(
          `${row.category}/${row.relPath}`,
          `${row.size}:${row.mtimeMs}:${row.contentHash}`,
        );
      }
    }

    await this.repo.delete({ rootId });

    for (const category of categories) {
      const categoryPath = resolve(rootPath, category);
      const records = await this.walkCategory(rootId, category, categoryPath);
      for (const record of records) {
        const cached = hashMap.get(`${record.category}/${record.relPath}`);
        if (cached && cached.startsWith(`${record.size}:${record.mtimeMs}:`)) {
          record.contentHash = cached.slice(
            `${record.size}:${record.mtimeMs}:`.length,
          );
        }
      }
      await this.insertInBatches(records);
    }
  }

  private async insertInBatches(records: FileRecord[]) {
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      if (batch.length > 0) {
        await this.repo.upsert(batch, ['rootId', 'category', 'relPath']);
      }
    }
  }

  /** 权限不足 / 目标已消失等可恢复错误：跳过该项，不中断整次同步 */
  private isSkippableError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === 'EPERM' || code === 'EACCES' || code === 'ENOENT';
  }

  private async walkCategory(
    rootId: string,
    category: string,
    dir: string,
    relBase = '',
  ): Promise<FileRecord[]> {
    // 目录不可读（如 macOS 的 Photos Library 受系统保护）时整棵子树跳过
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (error) => {
        if (!this.isSkippableError(error)) throw error;
        this.logger.warn(`跳过无权限读取的目录：${dir}`);
        return null;
      },
    );
    if (!entries) return [];

    const results: FileRecord[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = join(dir, entry.name);
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        results.push(
          ...(await this.walkCategory(rootId, category, absPath, relPath)),
        );
        continue;
      }
      if (!entry.isFile()) continue;

      // 单个文件 stat 失败（权限/失效软链）只跳过该文件
      const s = await stat(absPath).catch((error) => {
        if (!this.isSkippableError(error)) throw error;
        return null;
      });
      if (!s) continue;
      const ext = extname(entry.name).toLowerCase();
      results.push({
        rootId,
        category,
        relPath,
        name: entry.name,
        ext,
        size: s.size,
        mtimeMs: s.mtimeMs,
        // 扫盘阶段不计算哈希（IO 开销大），由 syncRoot 按快照恢复或检测接口惰性补算
        contentHash: null,
      });
    }

    return results;
  }

  async upsertOne(rootId: string, category: string, relPath: string) {
    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    const absPath = resolve(rootPath, category, ...relPath.split('/'));
    const s = await stat(absPath);
    const name = relPath.split('/').pop() ?? relPath;
    const ext = extname(name).toLowerCase();

    // 文件内容未变化（大小与修改时间一致）时保留已有哈希
    const existing = await this.repo.findOne({
      where: { rootId, category, relPath },
      select: { size: true, mtimeMs: true, contentHash: true },
    });
    const contentHash =
      existing &&
      existing.size === s.size &&
      existing.mtimeMs === s.mtimeMs &&
      existing.contentHash
        ? existing.contentHash
        : null;

    await this.repo.upsert(
      {
        rootId,
        category,
        relPath,
        name,
        ext,
        size: s.size,
        mtimeMs: s.mtimeMs,
        contentHash,
      },
      ['rootId', 'category', 'relPath'],
    );
  }

  async removeMany(rootId: string, category: string, relPaths: string[]) {
    const rows = await this.repo.find({
      where: { rootId, category, relPath: In(relPaths) },
      select: { id: true },
    });
    if (rows.length === 0) return;
    await this.repo.delete(rows.map((r) => r.id));
  }
}
