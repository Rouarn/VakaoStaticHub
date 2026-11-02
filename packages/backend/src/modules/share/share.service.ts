/**
 * 分享管理服务
 * 负责创建 / 列表 / 编辑 / 撤销 / 访问日志，不感知 HTTP 上下文
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { ShareLinkStatus, ShareListResult } from '@vakao/shared';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { ShareAccessLogEntity } from '#/infra/database/entities/share-access-log.entity.js';
import { hashPassword } from '../auth/utils/password.util.js';
import { FilesService } from '../files/files.service.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { ListShareLinksQueryDto } from './dto/list-share-links-query.dto.js';
import { UpdateShareLinkDto } from './dto/update-share-link.dto.js';
import { toShareLink, toShareAccessLog } from './share.mapper.js';

/** 单个分享最多包含的文件数（防止一次分享吞掉整个目录） */
const MAX_SHARE_FILES = 200;

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    @InjectRepository(ShareLinkEntity)
    private readonly repo: Repository<ShareLinkEntity>,
    @InjectRepository(ShareAccessLogEntity)
    private readonly accessLogRepo: Repository<ShareAccessLogEntity>,
    private readonly filesService: FilesService,
  ) {}

  async createShareLink(dto: CreateShareLinkDto) {
    const token = this.generateToken();
    const paths = [
      ...new Set(dto.filePaths.map((p) => p.trim()).filter(Boolean)),
    ];
    if (paths.length === 0) {
      throw new BadRequestException('请选择至少一个文件');
    }
    if (paths.length > MAX_SHARE_FILES) {
      throw new BadRequestException(`一次最多分享 ${MAX_SHARE_FILES} 个文件`);
    }

    // 逐条校验：路径合法（禁止 .. / 绝对路径）且文件真实存在
    const missing: string[] = [];
    for (const filePath of paths) {
      try {
        const fullPath = this.filesService.safeJoinCategory(
          dto.rootId,
          dto.category,
          [filePath],
        );
        await stat(fullPath);
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw new BadRequestException(`文件路径不合法：${filePath}`);
        }
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (!code) {
          // safeJoin 抛出的纯 Error('Invalid path') 属于路径穿越，不是文件缺失
          throw new BadRequestException(`文件路径不合法：${filePath}`);
        }
        missing.push(filePath);
      }
    }
    if (missing.length > 0) {
      throw new BadRequestException(
        `以下文件不存在或已被删除：${missing.join('、')}`,
      );
    }

    const entity = this.repo.create({
      token,
      rootId: dto.rootId,
      category: dto.category,
      filePaths: JSON.stringify(paths),
      remark: dto.remark?.trim() || null,
      enabled: 1,
      expiresAt: dto.expiresInMs ? Date.now() + dto.expiresInMs : null,
      maxAccesses: dto.maxAccesses ?? null,
      passwordHash: dto.password ? await hashPassword(dto.password) : null,
      accessCount: 0,
      createdAt: Date.now(),
    });

    const saved = await this.repo.save(entity);
    return toShareLink(saved);
  }

  /**
   * 管理端分页列表：关键字命中 token / 文件路径 / 分类 / 备注；
   * counts 恒为全量口径，不受分页与当前筛选影响
   */
  async listShareLinks(
    query: ListShareLinksQueryDto,
  ): Promise<ShareListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;

    const qb = this.repo.createQueryBuilder('s');
    if (query.q?.trim()) {
      qb.andWhere(
        "(LOWER(s.token) LIKE :q OR LOWER(s.filePaths) LIKE :q OR LOWER(s.category) LIKE :q OR LOWER(COALESCE(s.remark, '')) LIKE :q)",
        { q: `%${query.q.trim().toLowerCase()}%` },
      );
    }
    if (query.status) {
      this.applyStatusFilter(qb, query.status);
    }
    qb.orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, filteredTotal, all, active, expired, exhausted, disabled] =
      await Promise.all([
        qb.getMany(),
        qb.getCount(),
        this.countByStatus(),
        this.countByStatus('active'),
        this.countByStatus('expired'),
        this.countByStatus('exhausted'),
        this.countByStatus('disabled'),
      ]);

    return {
      items: items.map((link) => toShareLink(link)),
      total: filteredTotal,
      page,
      pageSize,
      counts: { all, active, expired, exhausted, disabled },
    };
  }

  /** 编辑分享链接：备注 / 有效期 / 密码 / 最大次数 / 启停 */
  async updateShareLink(token: string, dto: UpdateShareLinkDto) {
    const link = await this.findExistingLink(token);

    if (dto.remark !== undefined) {
      link.remark = dto.remark?.trim() || null;
    }
    if (dto.expiresAt !== undefined) {
      if (dto.expiresAt !== null && dto.expiresAt <= Date.now()) {
        throw new BadRequestException('过期时间必须晚于当前时间');
      }
      link.expiresAt = dto.expiresAt;
    }
    if (dto.password !== undefined) {
      link.passwordHash = dto.password
        ? await hashPassword(dto.password)
        : null;
    }
    if (dto.maxAccesses !== undefined) {
      link.maxAccesses = dto.maxAccesses;
    }
    if (dto.enabled !== undefined) {
      link.enabled = dto.enabled ? 1 : 0;
    }

    const saved = await this.repo.save(link);
    return toShareLink(saved);
  }

  async revokeShareLink(token: string) {
    const result = await this.repo.delete({ token });
    if (result.affected === 0) {
      throw new NotFoundException('分享链接不存在');
    }
    return { success: true };
  }

  /**
   * 异步写入一条分享访问记录
   * 采用 fire-and-forget 方式，记录失败仅打印日志，不影响文件访问
   */
  recordAccess(token: string, ip: string | null, userAgent: string | null) {
    const entity = this.accessLogRepo.create({
      shareToken: token,
      ip,
      userAgent,
      accessedAt: Date.now(),
    });
    void this.accessLogRepo.save(entity).catch((error: unknown) => {
      this.logger.warn(
        `写入分享访问记录失败 (token=${token}): ${String(error)}`,
      );
    });
  }

  /** 获取指定分享链接的访问记录列表，按访问时间倒序 */
  async listAccessLogs(token: string) {
    const link = await this.repo.findOne({ where: { token } });
    if (!link) {
      throw new NotFoundException('分享链接不存在');
    }
    const logs = await this.accessLogRepo.find({
      where: { shareToken: token },
      order: { accessedAt: 'DESC' },
    });
    return logs.map((log) => toShareAccessLog(log));
  }

  /** 查询分享链接，不存在时抛 404（停用语义由调用方按需追加） */
  private async findExistingLink(token: string) {
    const link = await this.repo.findOne({ where: { token } });
    if (!link) {
      throw new NotFoundException('分享链接不存在');
    }
    return link;
  }

  /** 状态筛选条件（互斥口径，四种状态之和等于全部） */
  private applyStatusFilter(
    qb: SelectQueryBuilder<ShareLinkEntity>,
    status: ShareLinkStatus,
  ) {
    const now = Date.now();
    switch (status) {
      case 'disabled':
        qb.andWhere('s.enabled = 0');
        break;
      case 'expired':
        qb.andWhere('s.enabled = 1')
          .andWhere('s.expiresAt IS NOT NULL')
          .andWhere('s.expiresAt <= :now', { now });
        break;
      case 'exhausted':
        qb.andWhere('s.enabled = 1')
          .andWhere('(s.expiresAt IS NULL OR s.expiresAt > :now)', { now })
          .andWhere('s.maxAccesses IS NOT NULL')
          .andWhere('s.accessCount >= s.maxAccesses');
        break;
      case 'active':
        qb.andWhere('s.enabled = 1')
          .andWhere('(s.expiresAt IS NULL OR s.expiresAt > :now)', { now })
          .andWhere('(s.maxAccesses IS NULL OR s.accessCount < s.maxAccesses)');
        break;
      default:
        break;
    }
  }

  /** 按状态统计数量（不传 status 表示全部） */
  private async countByStatus(status?: ShareLinkStatus): Promise<number> {
    const qb = this.repo.createQueryBuilder('s');
    if (status) {
      this.applyStatusFilter(qb, status);
    }
    return qb.getCount();
  }

  private generateToken(): string {
    // CSPRNG：16 字节 = 32 个十六进制字符（前端 SHARE_TOKEN_RE 按此校验）
    return randomBytes(16).toString('hex');
  }
}
