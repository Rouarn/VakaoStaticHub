/**
 * 分享公开访问服务
 * 负责公开 info / verify / 单项文件解析 / 多文件列表，不感知 HTTP 上下文
 */

import {
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ShareCollectionFile } from '@vakao/shared';
import { SHARE_ACCESS_TOKEN_TTL_MS } from '@vakao/shared';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { getMimeType } from '#/common/utils/mime.util.js';
import { verifyPassword } from '../auth/utils/password.util.js';
import { FilesService } from '../files/files.service.js';
import {
  deriveShareStatus,
  deriveShareType,
  parseFilePaths,
  toShareInfo,
} from './share.mapper.js';

/** 已通过校验的分享访问上下文 */
export interface ShareAccessContext {
  rootId: string;
  category: string;
  shareType: 'file' | 'collection';
  filePaths: string[];
  expiresAt: number | null;
  maxAccesses: number | null;
}

/** 单项访问解析结果（由 controller 负责输出文件流） */
export interface ShareSingleFile {
  path: string;
  fullPath: string;
  name: string;
  size: number;
  mimeType: string;
}

@Injectable()
export class ShareAccessService {
  constructor(
    @InjectRepository(ShareLinkEntity)
    private readonly repo: Repository<ShareLinkEntity>,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 获取分享链接的公开信息（用于前端判断是否需要密码）
   * 不返回敏感字段（如 passwordHash）
   */
  async getShareInfo(token: string) {
    const link = await this.findExistingLink(token);
    this.assertAccessible(link);
    return toShareInfo(link);
  }

  /**
   * 解锁分享链接（一次“打开”）：校验过期/次数/密码，通过后计数 +1 并签发访问令牌
   * 计数语义为“链接打开次数”：解锁成功才计数，解锁后凭令牌下载文件不再计数
   *
   * 执行顺序：先做轻量的过期/次数探测（纯数字比较，不涉及哈希计算），
   * 次数已用尽的请求在这里就直接返回，避免白白消耗昂贵的 scrypt 密码校验
   */
  async verify(token: string, password?: string) {
    const link = await this.findExistingLink(token);
    this.assertAccessible(link);

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
      throw new GoneException('分享链接打开次数已达上限');
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
  async validateFileAccess(
    token: string,
    accessToken?: string,
  ): Promise<ShareAccessContext> {
    const link = await this.findExistingLink(token);
    if (link.enabled === 0) {
      throw new GoneException('分享链接已停用');
    }

    if (link.expiresAt && Date.now() > link.expiresAt) {
      throw new GoneException('分享链接已过期');
    }

    if (!accessToken || !this.validateShareAccessToken(token, accessToken)) {
      throw new UnauthorizedException(
        '访问令牌无效或已过期，请重新打开分享链接',
      );
    }

    const filePaths = parseFilePaths(link.filePaths);
    return {
      rootId: link.rootId,
      category: link.category,
      shareType: deriveShareType(filePaths),
      filePaths,
      expiresAt: link.expiresAt,
      maxAccesses: link.maxAccesses,
    };
  }

  /** collection 分享的文件清单（逐个探测磁盘存在性，已删除文件不静默消失） */
  async listCollectionFiles(
    context: ShareAccessContext,
  ): Promise<ShareCollectionFile[]> {
    return await Promise.all(
      context.filePaths.map(async (filePath) => {
        const name = basename(filePath);
        try {
          const fileStat = await stat(
            this.filesService.safeJoinCategory(
              context.rootId,
              context.category,
              [filePath],
            ),
          );
          return {
            path: filePath,
            name,
            size: fileStat.size,
            exists: true,
          };
        } catch {
          // 单个文件被删除/无权限不影响其它文件展示
          return { path: filePath, name, size: null, exists: false };
        }
      }),
    );
  }

  /**
   * 解析单项访问目标
   * 单文件分享固定取第 0 项；collection 按 index 取对应项
   * @returns 索引越界时为 null（由 controller 输出 400）
   */
  async resolveSingleFile(
    context: ShareAccessContext,
    index?: string,
  ): Promise<ShareSingleFile | null> {
    const position = index === undefined ? 0 : Number(index);
    const filePath = context.filePaths[position];
    if (!filePath) {
      return null;
    }

    const fullPath = this.filesService.safeJoinCategory(
      context.rootId,
      context.category,
      [filePath],
    );
    const fileStat = await stat(fullPath);

    return {
      path: filePath,
      fullPath,
      name: basename(filePath),
      size: fileStat.size,
      mimeType: getMimeType(filePath),
    };
  }

  /**
   * 停用 / 过期 / 次数用尽的公开访问统一拦截
   * 三类「链接不可用」统一返回 410 Gone（与 404 未知 token、401 密码错误区分）
   */
  private assertAccessible(link: ShareLinkEntity) {
    switch (deriveShareStatus(link)) {
      case 'disabled':
        throw new GoneException('分享链接已停用');
      case 'expired':
        throw new GoneException('分享链接已过期');
      case 'exhausted':
        throw new GoneException('分享链接打开次数已达上限');
      default:
        break;
    }
  }

  /** 查询分享链接，不存在时抛 404 */
  private async findExistingLink(token: string) {
    const link = await this.repo.findOne({ where: { token } });
    if (!link) {
      throw new NotFoundException('分享链接不存在');
    }
    return link;
  }

  /**
   * 签发分享访问令牌
   * 格式：<timestamp>.<hmac>，有效期见 SHARE_ACCESS_TOKEN_TTL_MS
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

    // 形态必须为 <毫秒时间戳>.<64 位小写 hex>，否则直接判定无效，
    // 避免 timingSafeEqual 因长度不一致抛 RangeError 变成 500
    if (!/^\d{1,16}$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) {
      return false;
    }

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
   * 获取 HMAC 密钥，优先使用 JWT_SECRET（与 JWT 策略同源）
   */
  private getHmacSecret(): string {
    return (
      this.configService.get<string>('auth.jwtSecret') ??
      'vakao-share-access-secret'
    );
  }
}
