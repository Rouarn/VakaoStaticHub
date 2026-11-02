/**
 * APP 在线更新服务（多应用）
 *
 * 存储模型：software-update 资源根（与 storage 同级）下每个应用一个目录——
 *   software-update/{appKey}/v{versionCode}_{versionName}.apk
 * appKey 即资源分类名（xiaolv / xiaolan…），每个应用独立维护版本序列、灰度与强更。
 *
 * 能力：应用目录管理、版本检查（versionCode 判定 + 灰度 + 强更）、
 * APK 上传落地（流式 SHA-256）、发布门禁、强更开关、下架止血、事件上报
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  constants,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { AppUpgradeEventEntity } from '#/infra/database/entities/app-upgrade-event.entity.js';
import {
  AppVersionEntity,
  VERSION_STATUS,
} from '#/infra/database/entities/app-version.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import { safeJoin } from '../files/utils/path-utils.js';
import {
  SOFTWARE_UPDATE_ROOT_ID,
  SOFTWARE_UPDATE_ROOT_PATH,
  ENV_PUBLIC_BASE_URL,
} from './app-update.constants.js';
import { CheckUpdateQueryDto } from './dto/check-update-query.dto.js';
import { CreateVersionDto } from './dto/create-version.dto.js';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto.js';
import { PublishVersionDto } from './dto/publish-version.dto.js';
import { ReportEventDto } from './dto/report-event.dto.js';
import { UpdateVersionDto } from './dto/update-version.dto.js';
import { getApkTmpDir } from './apk-upload.interceptor.js';
import type { RollbackCandidatesResult, RollbackResult } from '@vakao/shared';

@Injectable()
export class AppUpdateService implements OnModuleInit {
  private readonly logger = new Logger(AppUpdateService.name);

  constructor(
    @InjectRepository(AppVersionEntity)
    private readonly versionRepo: Repository<AppVersionEntity>,
    @InjectRepository(AppUpgradeEventEntity)
    private readonly eventRepo: Repository<AppUpgradeEventEntity>,
    @InjectRepository(FileEntryEntity)
    private readonly fileEntryRepo: Repository<FileEntryEntity>,
    private readonly resourceRoots: ResourceRootsService,
    private readonly configService: ConfigService,
  ) {}

  /** 幂等注册软件更新专用资源根（与 storage 同级） */
  async onModuleInit() {
    if (!this.resourceRoots.getRoot(SOFTWARE_UPDATE_ROOT_ID)) {
      await this.resourceRoots.addRoot({
        id: SOFTWARE_UPDATE_ROOT_ID,
        name: 'APP 更新包',
        path: SOFTWARE_UPDATE_ROOT_PATH,
      });
    }
    await mkdir(this.resourceRoots.resolveRootPath(SOFTWARE_UPDATE_ROOT_ID), {
      recursive: true,
    });
    await mkdir(getApkTmpDir(), { recursive: true });
  }

  // ==================== 应用（资源分类）管理 ====================

  /** 列出 software-update 根下的全部应用（即资源分类目录） */
  async listApps() {
    const rootPath = this.resourceRoots.resolveRootPath(
      SOFTWARE_UPDATE_ROOT_ID,
    );
    await mkdir(rootPath, { recursive: true });
    const dirs = await readdir(rootPath, { withFileTypes: true });
    return dirs
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /** 新建应用目录（幂等：已存在则 409，避免误覆盖已有应用） */
  async createApp(appKey: string) {
    const rootPath = this.resourceRoots.resolveRootPath(
      SOFTWARE_UPDATE_ROOT_ID,
    );
    const targetPath = safeJoin(rootPath, [appKey]);
    try {
      await access(targetPath, constants.F_OK);
      throw new ConflictException(`应用 ${appKey} 已存在`);
    } catch (e) {
      if (e instanceof ConflictException) throw e;
    }
    await mkdir(targetPath, { recursive: true });
    return { appKey };
  }

  /**
   * 修改应用标识（重命名）：目录改名 + 全部关联记录迁移
   * 全部版本记录一并迁移——versionCode 历史按应用延续，不可因改名而断裂
   * 顺序：先迁移数据库（事务），再重命名目录；目录改名失败时操作可安全重试
   */
  async renameApp(appKey: string, newAppKey: string) {
    if (appKey === newAppKey) {
      throw new BadRequestException('新应用标识与当前标识相同');
    }
    const rootPath = this.resourceRoots.resolveRootPath(
      SOFTWARE_UPDATE_ROOT_ID,
    );
    const oldPath = safeJoin(rootPath, [appKey]);
    const newPath = safeJoin(rootPath, [newAppKey]);
    try {
      await access(oldPath, constants.F_OK);
    } catch {
      throw new NotFoundException(`应用 ${appKey} 不存在`);
    }
    try {
      await access(newPath, constants.F_OK);
      throw new ConflictException(`应用 ${newAppKey} 已存在`);
    } catch (e) {
      if (e instanceof ConflictException) throw e;
    }

    await this.versionRepo.manager.transaction(async (manager) => {
      await manager.update(
        AppVersionEntity,
        { appKey },
        { appKey: newAppKey, category: newAppKey },
      );
      await manager.update(
        AppUpgradeEventEntity,
        { appKey },
        { appKey: newAppKey },
      );
      await manager.update(
        FileEntryEntity,
        { rootId: SOFTWARE_UPDATE_ROOT_ID, category: appKey },
        { category: newAppKey },
      );
    });

    await rename(oldPath, newPath);
    return { appKey: newAppKey };
  }

  /**
   * 删除应用：物理删除整个应用目录 + 硬删除全部关联数据库记录（不可恢复）
   * 关联记录：版本记录（含历史）、升级事件、文件管理器索引
   * 顺序：先清数据库（事务），再删目录；目录删除失败时操作可安全重试
   */
  async deleteApp(appKey: string) {
    const rootPath = this.resourceRoots.resolveRootPath(
      SOFTWARE_UPDATE_ROOT_ID,
    );
    const appPath = safeJoin(rootPath, [appKey]);
    try {
      await access(appPath, constants.F_OK);
    } catch {
      throw new NotFoundException(`应用 ${appKey} 不存在`);
    }

    let versionCount = 0;
    let eventCount = 0;
    let fileCount = 0;
    await this.versionRepo.manager.transaction(async (manager) => {
      const v = await manager.delete(AppVersionEntity, { appKey });
      versionCount = v.affected ?? 0;
      const e = await manager.delete(AppUpgradeEventEntity, { appKey });
      eventCount = e.affected ?? 0;
      const f = await manager.delete(FileEntryEntity, {
        rootId: SOFTWARE_UPDATE_ROOT_ID,
        category: appKey,
      });
      fileCount = f.affected ?? 0;
    });

    await rm(appPath, { recursive: true, force: true });
    return { success: true, versionCount, eventCount, fileCount };
  }

  // ==================== 客户端接口 ====================

  /**
   * 版本检查（按应用隔离）
   * 判定基准唯一：以客户端上报的 versionCode 为准，
   * 同应用内服务端版本 ≤ 客户端版本一律无更新（防无限循环更新）
   */
  async checkUpdate(query: CheckUpdateQueryDto, req: Request) {
    let record = await this.findLatestVisible(query.platform, query.appKey);
    // 灰度版本未命中的设备回退到该应用的最大全量版本再判一次
    if (record && record.status === VERSION_STATUS.GRAY) {
      if (!this.grayHit(query.deviceId, record.grayPercent)) {
        record = await this.findLatestFull(query.platform, query.appKey);
      }
    }

    if (!record || query.versionCode >= record.versionCode) {
      return { hasUpdate: false };
    }

    return {
      hasUpdate: true,
      appKey: record.appKey,
      versionCode: record.versionCode,
      versionName: record.versionName,
      updateType: record.updateType,
      forceUpdate:
        record.forceUpdate === 1 || query.versionCode < record.minVersionCode,
      downloadUrl: this.buildDownloadUrl(req, record.id),
      packageSize: record.packageSize,
      checksum: record.checksum,
      updateLog: record.updateLog,
      publishTime: record.publishTime,
    };
  }

  /** 灰度命中判定：sha256(deviceId) 前 8 位十六进制取模，同一设备结果稳定（上线后公式即契约，不可再改） */
  grayHit(deviceId: string | undefined, grayPercent: number): boolean {
    if (grayPercent >= 100) return true;
    if (!deviceId || grayPercent <= 0) return false;
    const bucket =
      parseInt(
        createHash('sha256').update(deviceId).digest('hex').slice(0, 8),
        16,
      ) % 100;
    return bucket < grayPercent;
  }

  private findLatestVisible(platform: string, appKey: string) {
    return this.versionRepo.findOne({
      where: {
        platform,
        appKey,
        status: In([VERSION_STATUS.GRAY, VERSION_STATUS.PUBLISHED]),
      },
      order: { versionCode: 'DESC' },
    });
  }

  private findLatestFull(platform: string, appKey: string) {
    return this.versionRepo.findOne({
      where: {
        platform,
        appKey,
        status: VERSION_STATUS.PUBLISHED,
      },
      order: { versionCode: 'DESC' },
    });
  }

  /**
   * downloadUrl 动态生成、永不入库：换域名/端口零迁移。
   * APP_PUBLIC_BASE_URL 优先；否则取 x-forwarded-*（兼容反向代理）或请求自带协议与主机。
   */
  private buildDownloadUrl(req: Request, id: number): string {
    const prefix =
      this.configService.get<string>('server.staticPrefix') ?? 'static';
    const path = `${prefix}/app-updates/download/${id}`;
    const base = process.env[ENV_PUBLIC_BASE_URL];
    if (base) {
      return `${base.replace(/\/+$/, '')}/${path}`;
    }
    const proto =
      ((req.headers['x-forwarded-proto'] as string) ?? '').split(',')[0] ||
      req.protocol;
    const host =
      ((req.headers['x-forwarded-host'] as string) ?? '').split(',')[0] ||
      req.headers.host;
    return `${proto}://${host}/${path}`;
  }

  /** 查询可下载的版本记录（仅灰度/全量可见） */
  async getDownloadable(id: number) {
    const record = await this.versionRepo.findOne({
      where: { id },
    });
    if (
      !record ||
      (record.status !== VERSION_STATUS.GRAY &&
        record.status !== VERSION_STATUS.PUBLISHED)
    ) {
      throw new NotFoundException('安装包不存在或已下架');
    }
    return record;
  }

  /** 解析版本记录对应的磁盘绝对路径 */
  resolveApkPath(record: AppVersionEntity): string {
    const rootPath = this.resourceRoots.resolveRootPath(record.storageRootId);
    return safeJoin(rootPath, [record.category, record.relPath]);
  }

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

  // ==================== 管理端接口 ====================

  /** 上传 APK 并创建草稿版本（归入指定应用目录） */
  async createVersion(
    file: Express.Multer.File | undefined,
    dto: CreateVersionDto,
  ) {
    if (!file) {
      throw new BadRequestException('请上传 APK 文件（multipart 字段名 file）');
    }
    const platform = 'android';
    const appKey = dto.appKey;

    // 应用目录必须先创建（显式注册），避免上传误建拼写错误的应用
    const appPath = safeJoin(
      this.resourceRoots.resolveRootPath(SOFTWARE_UPDATE_ROOT_ID),
      [appKey],
    );
    try {
      await access(appPath, constants.F_OK);
    } catch {
      throw new BadRequestException(`应用 ${appKey} 不存在，请先创建应用`);
    }

    // versionCode 在同一应用内视为不可复用的历史（含已删除记录）
    const dup = await this.versionRepo.findOne({
      where: { platform, appKey, versionCode: dto.versionCode },
    });
    if (dup) {
      throw new ConflictException(
        `应用 ${appKey} 的 versionCode ${dto.versionCode} 已存在（历史版本号不可复用）`,
      );
    }

    if (
      dto.scheduledPublishAt !== undefined &&
      dto.scheduledPublishAt <= Date.now()
    ) {
      throw new BadRequestException('定时发布时间必须晚于当前时间');
    }

    const tmpPath = file.path;
    try {
      await this.assertApkMagic(tmpPath);

      const rootPath = this.resourceRoots.resolveRootPath(
        SOFTWARE_UPDATE_ROOT_ID,
      );
      // 文件名含版本号，永不覆盖旧文件（防"新 URL 旧内容"）
      const filename = `v${dto.versionCode}_${dto.versionName}.apk`;
      await mkdir(safeJoin(rootPath, [appKey]), { recursive: true });
      const finalPath = safeJoin(rootPath, [appKey, filename]);

      // 流式复制并计算 SHA-256，全程不占大块内存
      const hash = createHash('sha256');
      await pipeline(
        createReadStream(tmpPath),
        async function* (source) {
          for await (const chunk of source) {
            hash.update(chunk as Buffer);
            yield chunk;
          }
        },
        createWriteStream(finalPath),
      );
      const checksum = hash.digest('hex');
      const s = await stat(finalPath);

      try {
        // 同步文件管理器索引，保持存储体系统一
        await this.fileEntryRepo.upsert(
          {
            rootId: SOFTWARE_UPDATE_ROOT_ID,
            category: appKey,
            relPath: filename,
            name: filename,
            ext: '.apk',
            size: s.size,
            mtimeMs: s.mtimeMs,
          },
          ['rootId', 'category', 'relPath'],
        );

        const now = Date.now();
        const record = await this.versionRepo.save(
          this.versionRepo.create({
            platform,
            appKey,
            versionName: dto.versionName,
            versionCode: dto.versionCode,
            updateType: 'apk',
            packageSize: s.size,
            checksum,
            storageRootId: SOFTWARE_UPDATE_ROOT_ID,
            category: appKey,
            relPath: filename,
            updateLog: dto.updateLog ?? null,
            remark: dto.remark ?? null,
            forceUpdate: 0,
            minVersionCode: 0,
            grayPercent: 0,
            grayAutoIncrement: 0,
            grayIncrementSchedule: null,
            scheduledPublishAt: dto.scheduledPublishAt ?? null,
            scheduledPublishMode: dto.scheduledPublishMode ?? 'full',
            scheduledGrayPercent: dto.scheduledGrayPercent ?? 0,
            status: VERSION_STATUS.DRAFT,
            publishTime: null,
            createdAt: now,
            updatedAt: now,
          }),
        );
        return record;
      } catch (e) {
        // 记录创建失败时回滚物理文件，避免孤儿包
        await rm(finalPath, { force: true });
        throw e;
      }
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  /** ZIP 魔数校验（PK\x03\x04），拦截改名为 .apk 的非 APK 文件 */
  private async assertApkMagic(tmpPath: string) {
    const fd = await open(tmpPath, 'r');
    try {
      const buf = Buffer.alloc(4);
      await fd.read(buf, 0, 4, 0);
      if (
        buf[0] !== 0x50 ||
        buf[1] !== 0x4b ||
        buf[2] !== 0x03 ||
        buf[3] !== 0x04
      ) {
        throw new BadRequestException('文件内容不是合法的 APK（ZIP）包');
      }
    } finally {
      await fd.close();
    }
  }

  /** 分页版本列表（可按应用 / 状态 / 平台筛选） */
  async listVersions(query: ListVersionsQueryDto) {
    const qb = this.versionRepo.createQueryBuilder('v');

    if (query.appKey) {
      qb.where('v.appKey = :appKey', { appKey: query.appKey });
    }
    if (query.platform) {
      qb.andWhere('v.platform = :platform', { platform: query.platform });
    }
    if (query.status !== undefined) {
      qb.andWhere('v.status = :status', { status: query.status });
    }

    qb.orderBy('v.appKey', 'ASC')
      .addOrderBy('v.versionCode', 'DESC')
      .skip((query.page! - 1) * query.pageSize!)
      .take(query.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

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

  async getVersion(id: number) {
    return await this.getExisting(id);
  }

  /** 编辑元数据：仅草稿/已下架可改，发布态版本必须先下架 */
  async updateVersion(id: number, dto: UpdateVersionDto) {
    const record = await this.getExisting(id);
    if (
      record.status === VERSION_STATUS.GRAY ||
      record.status === VERSION_STATUS.PUBLISHED
    ) {
      throw new BadRequestException('发布中的版本不可编辑，请先下架');
    }
    if (dto.versionName !== undefined) record.versionName = dto.versionName;
    if (dto.updateLog !== undefined) record.updateLog = dto.updateLog;
    if (dto.remark !== undefined) record.remark = dto.remark;
    if (dto.scheduledPublishAt !== undefined) {
      if (
        dto.scheduledPublishAt !== null &&
        dto.scheduledPublishAt <= Date.now()
      ) {
        throw new BadRequestException('定时发布时间必须晚于当前时间');
      }
      record.scheduledPublishAt = dto.scheduledPublishAt;
    }
    if (dto.scheduledPublishMode !== undefined) {
      record.scheduledPublishMode = dto.scheduledPublishMode;
    }
    if (dto.scheduledGrayPercent !== undefined) {
      record.scheduledGrayPercent = dto.scheduledGrayPercent;
    }
    record.updatedAt = Date.now();
    return await this.versionRepo.save(record);
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
  async setForce(
    id: number,
    dto: { forceUpdate: boolean; minVersionCode?: number },
  ) {
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

  /**
   * 物理删除版本（不可恢复）：硬删除版本记录、该版本升级漏斗事件、文件管理器索引，
   * 并删除磁盘上的 APK 文件。仅草稿/已下架可删，发布态必须先下架止血。
   * 升级事件按 toVersionCode 归属（该版本安装包的下载/安装漏斗）；
   * fromVersionCode 命中的事件属于其他版本的升级漏斗，不在此删除。
   * 顺序：先清数据库（事务），再删文件；文件删除失败时不影响数据库清理结果
   */
  async remove(id: number) {
    const record = await this.getExisting(id);
    if (
      record.status === VERSION_STATUS.GRAY ||
      record.status === VERSION_STATUS.PUBLISHED
    ) {
      throw new BadRequestException('发布中的版本不可删除，请先下架');
    }

    const apkPath = this.resolveApkPath(record);
    let eventCount = 0;
    let fileCount = 0;
    await this.versionRepo.manager.transaction(async (manager) => {
      const e = await manager.delete(AppUpgradeEventEntity, {
        appKey: record.appKey,
        toVersionCode: record.versionCode,
      });
      eventCount = e.affected ?? 0;
      const f = await manager.delete(FileEntryEntity, {
        rootId: record.storageRootId,
        category: record.category,
        relPath: record.relPath,
      });
      fileCount = f.affected ?? 0;
      await manager.delete(AppVersionEntity, { id: record.id });
    });

    await rm(apkPath, { force: true });
    return { success: true, eventCount, fileCount };
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

  // ==================== 定时任务 ====================

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
        await this.publishVersion(record.id, {
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
