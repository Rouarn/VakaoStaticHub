import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Headers,
  Ip,
  NotFoundException,
  Param,
  Patch,
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
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import { Public } from '#/common/decorators/public.decorator.js';
import { CurrentUser } from '#/common/decorators/current-user.decorator.js';
import { getRequestMeta } from '#/common/utils/request-meta.util.js';
import { isPreviewable } from '#/common/utils/mime.util.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { ShareService } from './share.service.js';
import { ShareAccessService } from './share-access.service.js';
import { CreateShareLinkDto } from './dto/create-share-link.dto.js';
import { ListShareLinksQueryDto } from './dto/list-share-links-query.dto.js';
import { UpdateShareLinkDto } from './dto/update-share-link.dto.js';

@ApiTags('分享链接')
@Controller('share')
@UseGuards(JwtAuthGuard)
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly shareAccessService: ShareAccessService,
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
        fileCount: result.filePaths.length,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Get('list')
  @ApiOperation({
    summary: '获取分享链接列表（服务端分页 / 关键字 / 状态筛选）',
  })
  async listShareLinks(@Query() query: ListShareLinksQueryDto) {
    return await this.shareService.listShareLinks(query);
  }

  @Patch(':token')
  @ApiOperation({
    summary: '编辑分享链接（备注 / 有效期 / 密码 / 次数上限 / 启停）',
  })
  @ApiParam({ name: 'token', description: '分享 token' })
  async updateShareLink(
    @Param('token') token: string,
    @Body() dto: UpdateShareLinkDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.shareService.updateShareLink(token, dto);
    // 审计：编辑分享链接
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'share.update',
      resourceType: 'share',
      resourceId: token,
      details: {
        remark: dto.remark !== undefined,
        expiresAt: dto.expiresAt !== undefined,
        passwordChanged: dto.password !== undefined,
        maxAccesses: dto.maxAccesses !== undefined,
        enabled: dto.enabled,
      },
      ...getRequestMeta(req),
    });
    return result;
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
    return await this.shareAccessService.getShareInfo(token);
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
    const result = await this.shareAccessService.verify(token, body?.password);
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
      const linkInfo = await this.shareAccessService.validateFileAccess(
        token,
        accessToken,
      );

      // collection 类型且未指定 index 时，返回文件列表 JSON。
      // 注意：本方法用了 @Res()，全局 ResponseInterceptor 不会生效，
      // 必须手工输出与其它接口一致的 { code, message, data } 信封，
      // 否则前端 publicHttp 会把它当成业务失败。
      if (linkInfo.shareType === 'collection' && index === undefined) {
        const files =
          await this.shareAccessService.listCollectionFiles(linkInfo);
        res.json({
          code: 200,
          message: '成功',
          data: {
            shareType: linkInfo.shareType,
            rootId: linkInfo.rootId,
            category: linkInfo.category,
            files,
          },
        });
        return;
      }

      const file = await this.shareAccessService.resolveSingleFile(
        linkInfo,
        index,
      );
      if (!file) {
        res.status(400).json({ message: '无效的文件索引' });
        return;
      }

      const needsProcessing =
        file.mimeType.startsWith('image/') && (w || h || q || format);

      if (needsProcessing) {
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Length', file.size.toString());
        res.setHeader('Cache-Control', 'public, max-age=86400');
        createReadStream(file.fullPath).pipe(res);
        return;
      }

      const disposition =
        isPreviewable(file.mimeType) && isDownload === undefined
          ? 'inline'
          : 'attachment';

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size.toString());
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

      if (disposition === 'attachment') {
        const encodedFilename = encodeURIComponent(basename(file.name));
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodedFilename}`,
        );
      } else {
        res.setHeader('Content-Disposition', disposition);
      }

      createReadStream(file.fullPath).pipe(res);
    } catch (error) {
      if (error instanceof NotFoundException) {
        res.status(404).json({ message: '分享链接不存在' });
      } else if (error instanceof BadRequestException) {
        res.status(400).json({ message: error.message });
      } else if (error instanceof GoneException) {
        // 已停用：与「不存在」区分，明确告知链接已停用
        res.status(410).json({ message: error.message });
      } else if (error instanceof UnauthorizedException) {
        res.status(401).json({ message: error.message });
      } else if (
        (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
      ) {
        res.status(404).json({ message: '文件已被删除或不存在' });
      } else {
        res.status(500).json({ message: '访问文件失败' });
      }
    }
  }
}
