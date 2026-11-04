/**
 * APP 版本发布服务
 *
 * 负责版本生命周期中的状态变更：发布（全量/灰度）、强更开关、下架止血、回滚与候选查询。
 * 并发语义依赖 SQLite WAL 模式 + 事务内的门禁校验，禁止引入并行写入。
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AppVersionEntity,
  VERSION_STATUS,
} from '#/infra/database/entities/app-version.entity.js';
import type { RollbackCandidatesResult, RollbackResult } from '@vakao/shared';
import { ForceUpdateDto } from './dto/force-update.dto.js';
import { PublishVersionDto } from './dto/publish-version.dto.js';

@Injectable()
export class VersionPublishService {
  constructor(
    @InjectRepository(AppVersionEntity)
    private readonly versionRepo: Repository<AppVersionEntity>,
  ) {}

  /**
   * 回滚候选（服务端口径，与 rollback 事务内的候选规则一致）：
   * 同应用同平台、versionCode 更小、PUBLISHED 或被 publish 自动挤下架（offlineReason=auto）；
   * 管理员手动止血下架（manual）不返回，避免误恢复。
   */
  async listRollbackCandidates(id: number): Promise<RollbackCandidatesResult> {
    const record = await this.getExisting(id);
    const rows = await this.versionRepo
      .createQueryBuilder('v')
      .where('v.platform = :platform', { platform: record.platform })
      .andWhere('v.appKey = :appKey', { appKey: record.appKey })
      .andWhere('v.versionCode < :vc', { vc: record.versionCode })
      .andWhere(
        '(v.status = :pubStatus) OR (v.status = :offStatus AND v.offlineReason = :autoReason)',
        {
          pubStatus: VERSION_STATUS.PUBLISHED,
          offStatus: VERSION_STATUS.OFFLINE,
          autoReason: 'auto',
        },
      )
      .orderBy('v.versionCode', 'DESC')
      .getMany();

    return {
      candidates: rows.map((row) => ({
        id: row.id,
        versionCode: row.versionCode,
        versionName: row.versionName,
        status: row.status,
        offlineReason: row.offlineReason ?? null,
      })),
    };
  }

  /**
   * 发布（全量/灰度），按应用独立门禁
   * versionCode 必须大于该应用当前全量最大版本（排除自身）
   *
   * 防并发：门禁校验 + 改状态包进同一事务。SQLite 写锁是数据库级粒度，
   * 天然保证同一时刻只有一个发布请求能成功修改版本状态，
   * 并发请求会被串行排队；若排队期间有新的 PUBLISHED 版本插入，
   * 再进来的请求会再次拿到正确的 maxFull 做门禁，绕过"两个并发都通过旧门禁"的竞态。
   */
  async publishVersion(id: number, dto: PublishVersionDto) {
    // 先取一次基础信息（事务外，读不受锁影响）
    const preRecord = await this.getExisting(id);
    if (preRecord.status === VERSION_STATUS.PUBLISHED) {
      throw new ConflictException('该版本已全量发布');
    }

    const grayPercent = dto.mode === 'gray' ? dto.grayPercent : 0;
    if (dto.mode === 'gray' && !grayPercent) {
      throw new BadRequestException('灰度发布必须提供 grayPercent（1~99）');
    }

    // 灰度自动递增：必须提供递增时间表
    const autoIncrement = dto.mode === 'gray' && dto.grayAutoIncrement === true;
    if (autoIncrement && !dto.grayIncrementSchedule?.length) {
      throw new BadRequestException(
        '开启灰度自动递增时必须提供 grayIncrementSchedule',
      );
    }

    return await this.versionRepo.manager.transaction(async (manager) => {
      // 事务内重新查一次最新记录，避免读到事务外已被其他请求修改的脏数据
      const record = await manager.findOne(AppVersionEntity, {
        where: { id },
      });
      if (!record) {
        throw new NotFoundException('版本记录不存在');
      }
      if (record.status === VERSION_STATUS.PUBLISHED) {
        throw new ConflictException('该版本已全量发布');
      }

      // 事务内查询，与写操作串行化，保证 maxFull 是实时准确的
      const row = await manager
        .createQueryBuilder(AppVersionEntity, 'v')
        .select('MAX(v.versionCode)', 'max')
        .where('v.platform = :platform', { platform: record.platform })
        .andWhere('v.appKey = :appKey', { appKey: record.appKey })
        .andWhere('v.status = :status', { status: VERSION_STATUS.PUBLISHED })
        .andWhere('v.id != :id', { id: record.id })
        .getRawOne<{ max: number | string | null }>();
      const maxFull = row?.max == null ? null : Number(row.max);
      if (maxFull !== null && record.versionCode <= maxFull) {
        throw new ConflictException(
          `发布门禁：应用 ${record.appKey} 的 versionCode ${record.versionCode} 必须大于当前全量版本 ${maxFull}`,
        );
      }

      // 全量发布时：先把同 appKey 所有现有 PUBLISHED OFFLINE（标记为 auto），再把当前版本 PUBLISHED。
      // 这保证了"同一时刻只有一个 PUBLISHED"的强语义——即使并发多个都通过了门禁，
      // 最后一个进来的也会把前面已经 PUBLISHED 的下架，最终只剩一个。
      // 灰度发布不做这个（允许灰度和全量并存）。
      if (dto.mode === 'full') {
        await manager.update(
          AppVersionEntity,
          {
            platform: record.platform,
            appKey: record.appKey,
            status: VERSION_STATUS.PUBLISHED,
          },
          {
            status: VERSION_STATUS.OFFLINE,
            offlineReason: 'auto',
            updatedAt: Date.now(),
          },
        );
      }

      record.status =
        dto.mode === 'gray' ? VERSION_STATUS.GRAY : VERSION_STATUS.PUBLISHED;
      record.grayPercent = grayPercent ?? 0;
      record.grayAutoIncrement = autoIncrement ? 1 : 0;
      record.grayIncrementSchedule = autoIncrement
        ? JSON.stringify(dto.grayIncrementSchedule)
        : null;
      // 手动发布后清除定时发布设置 + 清除下架原因（重新全量/灰度发布不再是 OFFLINE）
      record.scheduledPublishAt = null;
      record.offlineReason = null;
      record.publishTime = Date.now();
      record.updatedAt = Date.now();
      return await manager.save(record);
    });
  }

  /** 远程强更开关（逃生口）：无需重新发版，坏包锁死时可反向解除 */
  async setForce(id: number, dto: ForceUpdateDto) {
    const record = await this.getExisting(id);
    record.forceUpdate = dto.forceUpdate ? 1 : 0;
    if (dto.minVersionCode !== undefined) {
      record.minVersionCode = dto.minVersionCode;
    }
    record.updatedAt = Date.now();
    return await this.versionRepo.save(record);
  }

  /**
   * 一键下架（止血开关）：只改状态不删文件，检查/下载立即不可见。
   * 标记 offlineReason='manual'，与 publish 自动下架的 'auto' 区分开——
   * manual 下架的版本不应被 rollback 自动恢复。
   */
  async offline(id: number) {
    const record = await this.getExisting(id);
    if (
      record.status !== VERSION_STATUS.PUBLISHED &&
      record.status !== VERSION_STATUS.GRAY
    ) {
      throw new BadRequestException('仅发布中（灰度/全量）的版本可下架');
    }
    record.status = VERSION_STATUS.OFFLINE;
    record.offlineReason = 'manual';
    record.updatedAt = Date.now();
    return await this.versionRepo.save(record);
  }

  /**
   * 一键回滚：下架目标版本（灰度/全量），并恢复该应用上一个全量版本在线。
   * 回滚目标取 versionCode 小于目标版本的最大历史版本（全量或已下架，已下架则重新发布）。
   *
   * 整个状态变更 + candidate 查找都在单事务中完成（防并发竞态）：
   * - publish 可能在 rollback 事务外查完 candidates 后、事务执行前，
   *   把另一个更高 versionCode 的版本设成 PUBLISHED
   * - 事务内重查 + 锁行，确保 rollbackTo 真的是"目标版本以下的最高全量"
   * - 同时保证事务后 PUBLISHED 条数仍为 1
   */
  async rollback(id: number): Promise<RollbackResult> {
    const preRecord = await this.getExisting(id);
    if (
      preRecord.status !== VERSION_STATUS.GRAY &&
      preRecord.status !== VERSION_STATUS.PUBLISHED
    ) {
      throw new BadRequestException('仅发布中（灰度/全量）的版本可回滚');
    }

    return await this.versionRepo.manager.transaction(async (manager) => {
      // 事务内重新查一次并锁行（SQLite 等不支持悲观锁的 driver 会静默跳过）
      let record;
      try {
        record = await manager
          .createQueryBuilder(AppVersionEntity, 'v')
          .where('v.id = :id', { id })
          .setLock('pessimistic_write')
          .getOne();
      } catch {
        // driver 不支持悲观锁时回退到无锁查询（SQLite WAL 库级锁已能串行化事务）
        record = await manager.findOne(AppVersionEntity, { where: { id } });
      }
      if (!record) {
        throw new NotFoundException('版本记录不存在');
      }
      if (
        record.status !== VERSION_STATUS.GRAY &&
        record.status !== VERSION_STATUS.PUBLISHED
      ) {
        throw new BadRequestException('仅发布中（灰度/全量）的版本可回滚');
      }

      // 事务内查回滚目标：同应用、同平台、versionCode < 目标版本。
      // 候选口径：
      //   - status=PUBLISHED：另一个全量版本（不应该有，但防御性保留）
      //   - status=OFFLINE AND offlineReason='auto'：被 publish 自动挤掉的历史版本 ✅ 可恢复
      //   - status=OFFLINE AND offlineReason='manual'：管理员手动止血下架 ❌ 不可自动恢复
      //   - 从未发布过的 DRAFT / 从未全量的 GRAY：不可能出现在这里（都 vc < target 且 IN 条件会排掉）
      const candidates = await manager
        .createQueryBuilder(AppVersionEntity, 'v')
        .where('v.platform = :platform', { platform: record.platform })
        .andWhere('v.appKey = :appKey', { appKey: record.appKey })
        .andWhere('v.versionCode < :vc', { vc: record.versionCode })
        .andWhere(
          '(v.status = :pubStatus) OR (v.status = :offStatus AND v.offlineReason = :autoReason)',
          {
            pubStatus: VERSION_STATUS.PUBLISHED,
            offStatus: VERSION_STATUS.OFFLINE,
            autoReason: 'auto',
          },
        )
        .orderBy('v.versionCode', 'DESC')
        .limit(1)
        .getOne();

      if (!candidates) {
        throw new BadRequestException(
          `应用 ${record.appKey} 不存在可回滚的历史全量版本`,
        );
      }

      const now = Date.now();
      // 下架当前目标版本（rollback 自身也是止血，标记 manual）
      await manager.update(
        AppVersionEntity,
        { id: record.id },
        {
          status: VERSION_STATUS.OFFLINE,
          offlineReason: 'manual',
          updatedAt: now,
        },
      );
      // 恢复下一个全量（如果它目前是 OFFLINE 的话）
      if (candidates.status !== VERSION_STATUS.PUBLISHED) {
        await manager.update(
          AppVersionEntity,
          { id: candidates.id },
          {
            status: VERSION_STATUS.PUBLISHED,
            offlineReason: null,
            publishTime: now,
            updatedAt: now,
          },
        );
      }

      return {
        success: true,
        rolledBack: { id: record.id, versionCode: record.versionCode },
        restored: {
          id: candidates.id,
          versionCode: candidates.versionCode,
          versionName: candidates.versionName,
        },
      };
    });
  }

  private async getExisting(id: number) {
    const record = await this.versionRepo.findOne({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('版本记录不存在');
    }
    return record;
  }
}
