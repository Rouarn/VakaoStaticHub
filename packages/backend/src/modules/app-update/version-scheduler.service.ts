/**
 * APP 版本定时任务
 *
 * - 灰度自动递增：每小时按递增时间表扩大灰度比例，达 100 自动转全量
 * - 定时发布：每 10 分钟扫描到点的草稿版本，按预设模式发布
 *
 * @Cron 表达式与时区/边界逻辑为现网契约，不得改动。
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  AppVersionEntity,
  VERSION_STATUS,
} from '#/infra/database/entities/app-version.entity.js';
import { VersionPublishService } from './version-publish.service.js';

@Injectable()
export class VersionSchedulerService {
  private readonly logger = new Logger(VersionSchedulerService.name);

  constructor(
    @InjectRepository(AppVersionEntity)
    private readonly versionRepo: Repository<AppVersionEntity>,
    private readonly publishService: VersionPublishService,
  ) {}

  /**
   * 灰度自动递增（每小时）：按发布时长匹配递增时间表，扩大灰度比例；
   * percent 达 100 时自动转为全量
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoIncrementGray() {
    const grays = await this.versionRepo.find({
      where: { status: VERSION_STATUS.GRAY, grayAutoIncrement: 1 },
    });
    for (const record of grays) {
      if (!record.grayIncrementSchedule || !record.publishTime) continue;
      let steps: { hours: number; percent: number }[];
      try {
        steps = JSON.parse(record.grayIncrementSchedule) as {
          hours: number;
          percent: number;
        }[];
      } catch {
        this.logger.warn(
          `版本 id=${record.id} 的灰度递增时间表 JSON 解析失败，跳过`,
        );
        continue;
      }
      const elapsedHours = (Date.now() - record.publishTime) / 3_600_000;
      const duePercents = steps
        .filter((s) => elapsedHours >= s.hours)
        .map((s) => s.percent);
      if (duePercents.length === 0) continue;
      const newPercent = Math.min(100, Math.max(...duePercents));
      if (newPercent <= record.grayPercent) continue;

      record.grayPercent = newPercent;
      record.updatedAt = Date.now();
      if (newPercent >= 100) {
        record.status = VERSION_STATUS.PUBLISHED;
        record.grayAutoIncrement = 0;
        this.logger.log(
          `应用 ${record.appKey} v${record.versionName} 灰度达 100%，自动转为全量`,
        );
      } else {
        this.logger.log(
          `应用 ${record.appKey} v${record.versionName} 灰度自动扩量至 ${newPercent}%`,
        );
      }
      await this.versionRepo.save(record);
    }
  }

  /**
   * 定时发布（每 10 分钟）：草稿且到点的版本自动按预设模式发布；
   * 发布失败（如门禁不满足）时清除定时设置并告警，避免无限重试
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async autoPublishScheduled() {
    const due = await this.versionRepo.find({
      where: {
        status: VERSION_STATUS.DRAFT,
        scheduledPublishAt: LessThanOrEqual(Date.now()),
      },
    });
    for (const record of due) {
      try {
        await this.publishService.publishVersion(record.id, {
          mode: record.scheduledPublishMode === 'gray' ? 'gray' : 'full',
          grayPercent:
            record.scheduledPublishMode === 'gray'
              ? record.scheduledGrayPercent
              : undefined,
        });
        this.logger.log(
          `应用 ${record.appKey} v${record.versionName} 定时发布成功（${record.scheduledPublishMode}）`,
        );
      } catch (e) {
        // 发布失败（如门禁不满足）：清除定时设置避免无限重试，人工介入处理
        record.scheduledPublishAt = null;
        record.updatedAt = Date.now();
        await this.versionRepo.save(record);
        this.logger.warn(
          `应用 ${record.appKey} v${record.versionName} 定时发布失败，已清除定时设置：${(e as Error).message}`,
        );
      }
    }
  }
}
