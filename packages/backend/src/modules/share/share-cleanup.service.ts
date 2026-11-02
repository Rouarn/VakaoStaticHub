/**
 * 分享清理服务
 * 过期或访问次数用尽的分享链接在每日清理任务中被删除
 * 调度仍由 files/cleanup 的单一 03:00 Cron 串联触发，保证与缩略图、孤儿分片清理的顺序不变
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';

@Injectable()
export class ShareCleanupService {
  private readonly logger = new Logger(ShareCleanupService.name);

  constructor(
    @InjectRepository(ShareLinkEntity)
    private readonly shareRepo: Repository<ShareLinkEntity>,
  ) {}

  /** 清理过期分享链接（expiresAt 已过或 accessCount >= maxAccesses） */
  @OnEvent('share.cleanup.expired', { suppressErrors: false })
  async cleanupExpiredShares() {
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
}
