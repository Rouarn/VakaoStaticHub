import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { CurrentUser } from '#/common/decorators/current-user.decorator.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { getRequestMeta } from '#/utils/request-meta.util.js';
import { ShareService } from './share.service.js';
import { FilesService } from '../files/files.service.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { getMimeType, isPreviewable } from '../files/utils/mime-types.js';

@ApiTags('分享链接')
@Controller('share')
@UseGuards(JwtAuthGuard)
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly filesService: FilesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建分享链接' })
  async createShareLink(
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.shareService.createShareLink(dto);
    // 审计：创建分享链接
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'share.create',
      resourceType: 'share',
      resourceId: result.token,
      details: {
        rootId: dto.rootId,
        category: dto.category,
        shareType: result.shareType,
        fileCount: result.filePaths?.length ?? 1,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Get('list')
  @ApiOperation({ summary: '获取分享链接列表' })
  async listShareLinks() {
    return await this.shareService.listShareLinks();
  }

  @Get(':token/access-logs')
  @ApiOperation({ summary: '获取分享链接的访问记录（仅登录用户可见）' })
  @ApiParam({ name: 'token', description: '分享 token' })
  async listAccessLogs(@Param('token') token: string) {
    return await this.shareService.listAccessLogs(token);
  }

  @Delete(':token')
  @ApiOperation({ summary: '撤销分享链接' })
  @ApiParam({ name: 'token', description: '分享 token' })
  async revokeShareLink(
    @Param('token') token: string,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.shareService.revokeShareLink(token);
    // 审计：撤销分享链接
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'share.revoke',
      resourceType: 'share',
      resourceId: token,
      ...getRequestMeta(req),
    });
    return result;
  }

  @Public()
  @Get(':token/info')
  @ApiOperation({ summary: '获取分享链接元信息' })
  @ApiParam({ name: 'token', description: '分享 token' })
  async getShareInfo(@Param('token') token: string) {
    return await this.shareService.getShareInfo(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/verify')
  @ApiOperation({ summary: '解锁分享链接（校验密码，无密码链接直接解锁）' })
  @ApiParam({ name: 'token', description: '分享 token' })
  async unlockShareLink(
    @Param('token') token: string,
    @Body() body: { password?: string } | undefined,
    @Ip() ip: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
  ) {
    const result = await this.shareService.unlock(token, body?.password);
    // 一次成功解锁记一条访问日志（打开链接一次，而非每个文件一条）
    this.shareService.recordAccess(token, ip ?? null, userAgent ?? null);
    return result;
  }

  @Public()
  @Get(':token')
  @ApiOperation({ summary: '通过分享链接访问文件' })
  @ApiParam({ name: 'token', description: '分享 token' })
  async accessShareLink(
    @Param('token') token: string,
    @Query('download') isDownload: string | undefined,
    @Query('w') w: string | undefined,
    @Query('h') h: string | undefined,
    @Query('q') q: string | undefined,
    @Query('format') format: string | undefined,
    @Query('index') index: string | undefined,
    @Query('accessToken') accessToken: string | undefined,
    @Res() res: Response,
  ) {
    try {
      const linkInfo = await this.shareService.validateFileAccess(
        token,
        accessToken,
      );

      // collection 类型且未指定 index 时，返回文件列表 JSON
      if (linkInfo.shareType === 'collection' && index === undefined) {
        res.json({
          shareType: linkInfo.shareType,
          category: linkInfo.category,
          files: linkInfo.filePaths ?? [],
        });
        return;
      }

      // collection 类型且指定了 index 时，按 index 取文件路径
      const filePath =
        linkInfo.shareType === 'collection' && index !== undefined
          ? (linkInfo.filePaths ?? [])[Number(index)]
          : linkInfo.filePath;

      if (!filePath) {
        res.status(400).json({ message: '无效的文件索引' });
        return;
      }

      const fullPath = this.filesService.safeJoinCategory(
        linkInfo.rootId,
        linkInfo.category,
        [filePath],
      );

      const s = await stat(fullPath);
      const mimeType = getMimeType(filePath);

      const needsProcessing =
        mimeType.startsWith('image/') && (w || h || q || format);

      if (needsProcessing) {
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', s.size.toString());
        res.setHeader('Cache-Control', 'public, max-age=86400');
        createReadStream(fullPath).pipe(res);
        return;
      }

      const disposition =
        isPreviewable(mimeType) && isDownload === undefined
          ? 'inline'
          : 'attachment';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', s.size.toString());
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

      if (disposition === 'attachment') {
        const encodedFilename = encodeURIComponent(basename(filePath));
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodedFilename}`,
        );
      } else {
        res.setHeader('Content-Disposition', disposition);
      }

      createReadStream(fullPath).pipe(res);
    } catch (error) {
      if (error instanceof NotFoundException) {
        res.status(404).json({ message: '分享链接不存在' });
      } else if (error instanceof BadRequestException) {
        res.status(400).json({ message: error.message });
      } else if (error instanceof UnauthorizedException) {
        res.status(401).json({ message: error.message });
      } else {
        res.status(500).json({ message: '访问文件失败' });
      }
    }
  }
}
