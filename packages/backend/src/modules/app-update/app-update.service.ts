/**
 * APP 在线更新服务（多应用）
 *
 * 存储模型：software-update 资源根（与 storage 同级）下每个应用一个目录——
 *   software-update/{appKey}/v{versionCode}_{versionName}.apk
 * appKey 即资源分类名（xiaolv / xiaolan…），每个应用独立维护版本序列、灰度与强更。
 *
 * 能力：应用目录管理、版本检查（versionCode 判定 + 灰度 + 强更）、
 * APK 上传落地（流式 SHA-256）、版本 CRUD
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { In, Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { AppUpgradeEventEntity } from '#/infra/database/entities/app-upgrade-event.entity.js';
import {
  AppVersionEntity,
  VERSION_STATUS,
} from '#/infra/database/entities/app-version.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import { safeJoin } from '#/common/utils/path.util.js';
import {
  SOFTWARE_UPDATE_ROOT_ID,
  SOFTWARE_UPDATE_ROOT_PATH,
  ENV_PUBLIC_BASE_URL,
} from './app-update.constants.js';
import { CheckUpdateQueryDto } from './dto/check-update-query.dto.js';
import { CreateVersionDto } from './dto/create-version.dto.js';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto.js';
import { UpdateVersionDto } from './dto/update-version.dto.js';
import { getApkTmpDir } from './apk-upload.interceptor.js';

@Injectable()
export class AppUpdateService implements OnModuleInit {
  constructor(
    @InjectRepository(AppVersionEntity)
    private readonly versionRepo: Repository<AppVersionEntity>,
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
    const base = this.configService.get<string>(ENV_PUBLIC_BASE_URL);
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
}
