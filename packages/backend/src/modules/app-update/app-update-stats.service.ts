import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUpgradeEventEntity } from '#/infra/database/entities/app-upgrade-event.entity.js';
import { AppVersionEntity } from '#/infra/database/entities/app-version.entity.js';
import type { FunnelStatItem, FunnelStatsResult } from '@vakao/shared';
import { ReportEventDto } from './dto/report-event.dto.js';

interface RawFunnelRow {
  toVersionCode: string | number | null;
  event: string;
  count: string | number;
}

@Injectable()
export class AppUpdateStatsService {
  constructor(
    @InjectRepository(AppUpgradeEventEntity)
    private readonly eventRepo: Repository<AppUpgradeEventEntity>,
    @InjectRepository(AppVersionEntity)
    private readonly versionRepo: Repository<AppVersionEntity>,
  ) {}

  /** 事件上报：单条轻量写入，失败由调用方吞掉（客户端无感） */
  async reportEvent(dto: ReportEventDto) {
    const event = this.eventRepo.create({
      deviceId: dto.deviceId,
      appKey: dto.appKey,
      event: dto.event,
      fromVersionCode: dto.fromVersionCode ?? null,
      toVersionCode: dto.toVersionCode ?? null,
      failCode: dto.failCode ?? null,
      networkType: dto.networkType ?? null,
      osVersion: dto.osVersion ?? null,
      deviceModel: dto.deviceModel ?? null,
      costMs: dto.costMs ?? null,
      createdAt: Date.now(),
    });
    await this.eventRepo.insert(event);
    return { success: true };
  }

  async getFunnelStats(
    appKey: string,
    startTime: number,
    endTime: number,
  ): Promise<FunnelStatsResult> {
    const rows = await this.eventRepo
      .createQueryBuilder('e')
      .select('e.toVersionCode', 'toVersionCode')
      .addSelect('e.event', 'event')
      .addSelect('COUNT(*)', 'count')
      .where('e.appKey = :appKey', { appKey })
      .andWhere('e.createdAt BETWEEN :startTime AND :endTime', {
        startTime,
        endTime,
      })
      .groupBy('e.toVersionCode')
      .addGroupBy('e.event')
      .getRawMany<RawFunnelRow>();

    const versionCodes = [
      ...new Set(
        rows
          .map((r) =>
            r.toVersionCode == null ? null : Number(r.toVersionCode),
          )
          .filter((v): v is number => v !== null && !Number.isNaN(v)),
      ),
    ];

    const versions =
      versionCodes.length > 0
        ? await this.versionRepo.find({
            where: versionCodes.map((vc) => ({ appKey, versionCode: vc })),
          })
        : [];
    const versionMap = new Map(
      versions.map((v) => [v.versionCode, v.versionName]),
    );

    const groups = new Map<number, Record<string, number>>();
    let checkNoUpdateTotal = 0;

    for (const row of rows) {
      const event = String(row.event);
      const count = Number(row.count) || 0;
      if (event === 'check_no_update') {
        checkNoUpdateTotal += count;
        continue;
      }
      const vc = row.toVersionCode == null ? 0 : Number(row.toVersionCode);
      if (!groups.has(vc)) groups.set(vc, {});
      groups.get(vc)![event] = count;
    }

    const items: FunnelStatItem[] = [];
    for (const [toVersionCode, counts] of groups) {
      const promptShow = counts['prompt_show'] || 0;
      const downloadStart = counts['download_start'] || 0;
      const downloadSuccess = counts['download_success'] || 0;
      const downloadFail = counts['download_fail'] || 0;
      const verifyFail = counts['verify_fail'] || 0;
      const installSuccess = counts['install_success'] || 0;
      const installFail = counts['install_fail'] || 0;
      const newVersionLaunch = counts['new_version_launch'] || 0;

      items.push({
        toVersionCode,
        versionName: versionMap.get(toVersionCode) || '',
        checkNoUpdate: 0,
        promptShow,
        downloadStart,
        downloadSuccess,
        downloadFail,
        verifyFail,
        installSuccess,
        installFail,
        newVersionLaunch,
        downloadRate: promptShow
          ? ((downloadStart / promptShow) * 100).toFixed(2) + '%'
          : '0%',
        installRate: downloadSuccess
          ? ((installSuccess / downloadSuccess) * 100).toFixed(2) + '%'
          : '0%',
        overallRate: promptShow
          ? ((installSuccess / promptShow) * 100).toFixed(2) + '%'
          : '0%',
      });
    }

    items.sort((a, b) => b.toVersionCode - a.toVersionCode);

    return { appKey, items, checkNoUpdateTotal };
  }
}
