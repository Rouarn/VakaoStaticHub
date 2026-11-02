import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ShareLinkStatus, ShareListResult } from '@vakao/shared';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { ShareAccessLogEntity } from '#/infra/database/entities/share-access-log.entity.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { ListShareLinksQueryDto } from './dto/list-share-links-query.dto.js';
import { UpdateShareLinkDto } from './dto/update-share-link.dto.js';
import { hashPassword, verifyPassword } from '../auth/utils/password.util.js';

/** 分享访问令牌有效期：30 分钟 */
const SHARE_ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(
    @InjectRepository(ShareLinkEntity)
    private readonly repo: Repository<ShareLinkEntity>,
    @InjectRepository(ShareAccessLogEntity)
    private readonly accessLogRepo: Repository<ShareAccessLogEntity>,
  ) {}

  async createShareLink(dto: CreateShareLinkDto) {
    const token = this.generateToken();
    const shareType = dto.shareType ?? 'file';

    // collection 类型时，将 filePaths 序列化为 JSON 存储；单文件保持原有行为
    const filePathsJson =
      shareType === 'collection' && dto.filePaths?.length
        ? JSON.stringify(dto.filePaths)
        : null;

    const entity = this.repo.create({
      token,
      rootId: dto.rootId,
      category: dto.category,
      filePath: dto.filePath,
      shareType,
      filePaths: filePathsJson,
      remark: dto.remark?.trim() || null,
      enabled: 1,
      expiresAt: dto.expiresInMs ? Date.now() + dto.expiresInMs : null,
      maxAccesses: dto.maxAccesses ?? null,
      passwordHash: dto.password ? await hashPassword(dto.password) : null,
      accessCount: 0,
      createdAt: Date.now(),
    });

    const saved = await this.repo.save(entity);
    return this.toShareLink(saved);
  }

  /**
   * 解锁分享链接（一次"打开"）：校验过期/次数/密码，通过后计数 +1 并签发访问令牌
   * 计数语义为"链接打开次数"：解锁成功才计数，解锁后凭令牌下载文件不再计数
   *
   * 执行顺序：先做轻量的过期/次数探测（纯数字比较，不涉及哈希计算），
   * 次数已用尽的请求在这里就直接返回，避免白白消耗昂贵的 scrypt 密码校验
   */
  async unlock(token: string, password?: string) {
    const link = await this.findExistingLink(token);
    if (link.enabled === 0) {
      throw new GoneException('分享链接已停用');
    }

    if (link.expiresAt && Date.now() > link.expiresAt) {
      throw new BadRequestException('分享链接已过期');
    }

    // 轻量次数探测：未达上限才继续，已用尽直接返回（不做密码哈希计算）
    if (
      link.maxAccesses !== null &&
      link.maxAccesses !== undefined &&
      link.accessCount >= link.maxAccesses
    ) {
      throw new BadRequestException('分享链接打开次数已达上限');
    }

    if (link.passwordHash) {
      if (!password) {
        throw new UnauthorizedException('该分享链接需要访问密码');
      }
      const ok = await verifyPassword(password, link.passwordHash);
      if (!ok) {
        throw new UnauthorizedException('访问密码错误');
      }
    }

    // 条件原子自增：未设置上限或未达上限时才 +1，避免并发下突破上限
    const result = await this.repo
      .createQueryBuilder()
      .update(ShareLinkEntity)
      .set({ accessCount: () => 'accessCount + 1' })
      .where('id = :id', { id: link.id })
      .andWhere('(maxAccesses IS NULL OR accessCount < maxAccesses)')
      .execute();

    if (!result.affected) {
      throw new BadRequestException('分享链接打开次数已达上限');
    }

    return {
      success: true as const,
      accessToken: this.signShareAccessToken(token),
    };
  }

  /**
   * 校验文件下载/预览请求
   * 打开后凭有效访问令牌访问，不再消耗打开次数
   * @param token 分享 token
   * @param accessToken 解锁时签发的访问令牌（必填）
   */
  async validateFileAccess(token: string, accessToken?: string) {
    const link = await this.findExistingLink(token);
    if (link.enabled === 0) {
      throw new GoneException('分享链接已停用');
    }

    if (link.expiresAt && Date.now() > link.expiresAt) {
      throw new BadRequestException('分享链接已过期');
    }

    if (!accessToken || !this.validateShareAccessToken(token, accessToken)) {
      throw new UnauthorizedException(
        '访问令牌无效或已过期，请重新打开分享链接',
      );
    }

    return {
      rootId: link.rootId,
      category: link.category,
      filePath: link.filePath,
      shareType: link.shareType,
      filePaths: this.parseFilePaths(link.filePaths),
      expiresAt: link.expiresAt,
      maxAccesses: link.maxAccesses,
    };
  }

  /**
   * 获取分享链接的公开信息（用于前端判断是否需要密码）
   * 不返回敏感字段（如 passwordHash）
   */
  async getShareInfo(token: string) {
    const link = await this.findExistingLink(token);
    if (link.enabled === 0) {
      throw new GoneException('分享链接已停用');
    }
    return {
      token: link.token,
      rootId: link.rootId,
      category: link.category,
      filePath: link.filePath,
      shareType: link.shareType,
      filePaths: this.parseFilePaths(link.filePaths),
      expiresAt: link.expiresAt,
      maxAccesses: link.maxAccesses,
      hasPassword: !!link.passwordHash,
    };
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
        "(LOWER(s.token) LIKE :q OR LOWER(s.filePath) LIKE :q OR LOWER(s.category) LIKE :q OR LOWER(COALESCE(s.remark, '')) LIKE :q)",
        { q: `%${query.q.trim().toLowerCase()}%` },
      );
    }
    if (query.status) {
      this.applyStatusFilter(qb, query.status);
    }
    qb.orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const now = Date.now();
    const [items, filteredTotal, all, active, expired, exhausted, disabled] =
      await Promise.all([
        qb.getMany(),
        qb.getCount(),
        this.countByStatus(undefined, now),
        this.countByStatus('active', now),
        this.countByStatus('expired', now),
        this.countByStatus('exhausted', now),
        this.countByStatus('disabled', now),
      ]);

    return {
      items: items.map((link) => this.toShareLink(link)),
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
    return this.toShareLink(saved);
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
    return logs.map((log) => ({
      id: log.id,
      shareToken: log.shareToken,
      ip: log.ip,
      userAgent: log.userAgent,
      accessedAt: log.accessedAt,
    }));
  }

  /** 将数据库中的 JSON 字符串解析为 string[]，解析失败返回 null */
  private parseFilePaths(filePaths: string | null): string[] | null {
    if (!filePaths) return null;
    try {
      const parsed = JSON.parse(filePaths) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      return null;
    }
  }

  /** 查询分享链接，不存在时抛 404（停用语义由调用方按需追加） */
  private async findExistingLink(token: string) {
    const link = await this.repo.findOne({ where: { token } });
    if (!link) {
      throw new NotFoundException('分享链接不存在');
    }
    return link;
  }

  /**
   * 状态筛选条件（互斥口径，四种状态之和等于全部）：
   * disabled > expired > exhausted > active
   */
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
  private async countByStatus(
    status: ShareLinkStatus | undefined,
    now: number,
  ): Promise<number> {
    const qb = this.repo.createQueryBuilder('s');
    if (status) {
      this.applyStatusFilter(qb, status);
    }
    // 显式使用 now 以保持签名一致；applyStatusFilter 内部使用 Date.now()
    void now;
    return qb.getCount();
  }

  /** 实体 → 管理端列表/详情返回结构 */
  private toShareLink(link: ShareLinkEntity) {
    return {
      id: link.id,
      token: link.token,
      rootId: link.rootId,
      category: link.category,
      filePath: link.filePath,
      shareType: link.shareType,
      filePaths: this.parseFilePaths(link.filePaths),
      remark: link.remark,
      enabled: link.enabled !== 0,
      expiresAt: link.expiresAt,
      maxAccesses: link.maxAccesses,
      hasPassword: !!link.passwordHash,
      accessCount: link.accessCount,
      createdAt: link.createdAt,
    };
  }

  private generateToken(): string {
    // CSPRNG：16 字节 = 32 个十六进制字符，与前端现有解析约定兼容
    return randomBytes(16).toString('hex');
  }

  /**
   * 签发分享访问令牌
   * 格式：<timestamp>.<hmac>，有效期 30 分钟
   * 使用 JWT_SECRET 作为 HMAC 密钥
   */
  private signShareAccessToken(token: string): string {
    const timestamp = Date.now();
    const payload = `${token}.${timestamp}`;
    const hmac = createHmac('sha256', this.getHmacSecret())
      .update(payload)
      .digest('hex');
    return `${timestamp}.${hmac}`;
  }

  /**
   * 校验分享访问令牌是否有效且未过期
   */
  private validateShareAccessToken(
    token: string,
    accessToken: string,
  ): boolean {
    const parts = accessToken.split('.');
    if (parts.length !== 2) return false;

    const timestamp = Number(parts[0]);
    if (!Number.isFinite(timestamp)) return false;

    // 令牌已过期
    if (Date.now() - timestamp > SHARE_ACCESS_TOKEN_TTL_MS) return false;

    const payload = `${token}.${timestamp}`;
    const expected = createHmac('sha256', this.getHmacSecret())
      .update(payload)
      .digest('hex');

    return timingSafeEqual(
      Buffer.from(parts[1], 'hex'),
      Buffer.from(expected, 'hex'),
    );
  }

  /**
   * 获取 HMAC 密钥，优先使用 JWT_SECRET 环境变量
   */
  private getHmacSecret(): string {
    return process.env.JWT_SECRET ?? 'vakao-share-access-secret';
  }
}
