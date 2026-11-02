import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { access, constants, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { UPLOAD_ID_REGEX } from './utils/path-utils.js';
import { ImageProcessorService } from './image-processor.service.js';

/** 分片上传临时目录 mtime 超过此阈值视为"孤儿"（默认 24 小时） */
const UPLOAD_IDLE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly imageProcessor: ImageProcessorService,
    @InjectRepository(ShareLinkEntity)
    private readonly shareRepo: Repository<ShareLinkEntity>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCleanup() {
    this.logger.log('Starting daily cleanup...');
    await this.cleanupThumbnails();
    await this.cleanupExpiredShares();
    await this.cleanupOrphanUploads();
    this.logger.log('Daily cleanup finished');
  }

  /** 清理缩略图缓存：删除源文件已不存在的缓存文件 */
  private async cleanupThumbnails() {
    const manifest = await this.imageProcessor.getManifest();
    const orphans: string[] = [];

    for (const [cacheFile, info] of Object.entries(manifest)) {
      try {
        await access(info.sourcePath, constants.F_OK);
      } catch {
        orphans.push(cacheFile);
      }
    }

    if (orphans.length > 0) {
      await this.imageProcessor.removeCacheEntries(orphans);
      this.logger.log(
        `Cleaned ${orphans.length} orphaned thumbnail cache entries`,
      );
    } else {
      this.logger.log('No orphaned thumbnail cache entries found');
    }
  }

  /** 清理过期分享链接 */
  private async cleanupExpiredShares() {
    const now = Date.now();
    const result = await this.shareRepo
      .createQueryBuilder()
      .delete()
      .where([{ expiresAt: LessThan(now) }])
      .orWhere('maxAccesses IS NOT NULL AND accessCount >= maxAccesses')
      .execute();

    const deleted = result.affected ?? 0;
    this.logger.log(`Cleaned ${deleted} expired share links`);
  }

  /**
   * 清理分片上传临时目录里的孤儿子目录：
   * uploadId 目录名符合 32 位十六进制规则 + mtime 超过 24 小时视为"客户端已断连未 cancel"，
   * 安全删除；跳过命名空间外的目录，避免误删同系统临时目录里其他应用的东西。
   */
  private async cleanupOrphanUploads() {
    const root = this.configService.get<string>('files.uploadTempDir');
    if (!root) return;

    let entries: string[];
    try {
      await access(root, constants.F_OK);
      entries = await readdir(root);
    } catch {
      // 目录不存在或不可读：首次部署 / 权限问题，跳过
      return;
    }

    const now = Date.now();
    const orphanDirs: string[] = [];

    for (const entryName of entries) {
      // 只处理 uploadId 格式的子目录，跳过命名空间外的目录避免误删系统临时文件
      if (!UPLOAD_ID_REGEX.test(entryName)) continue;
      const entryPath = resolve(root, entryName);
      try {
        const st = await stat(entryPath);
        if (!st.isDirectory()) continue;
        if (now - st.mtimeMs > UPLOAD_IDLE_MS) {
          orphanDirs.push(entryPath);
        }
      } catch {
        // 并发下可能刚被其他线程删掉，忽略
      }
    }

    let cleaned = 0;
    for (const dir of orphanDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
        cleaned++;
      } catch (error) {
        this.logger.warn(
          `Failed to remove orphan upload dir ${dir}: ${(error as Error).message}`,
        );
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned ${cleaned} orphaned upload temp dirs`);
    } else {
      this.logger.log('No orphaned upload temp dirs found');
    }
  }
}
