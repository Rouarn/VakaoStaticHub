/**
 * APP 应用管理接口（JWT 鉴权）
 * 应用 = software-update 资源根下的分类目录（xiaolv / xiaolan…），每个应用独立维护版本
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import { CurrentUser } from '#/common/decorators/current-user.decorator.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { getRequestMeta } from '#/common/utils/request-meta.util.js';
import { AppUpdateService } from './app-update.service.js';
import { CreateAppDto } from './dto/create-app.dto.js';
import { RenameAppDto } from './dto/rename-app.dto.js';

@ApiTags('APP 更新（管理端）')
@ApiBearerAuth()
@Controller('app-updates/apps')
@UseGuards(JwtAuthGuard)
export class AppController {
  constructor(
    private readonly service: AppUpdateService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '获取全部应用标识（software-update 根下的分类目录）',
  })
  async list() {
    return await this.service.listApps();
  }

  @Post()
  @ApiOperation({ summary: '新建应用（创建应用目录）' })
  async create(
    @Body() dto: CreateAppDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.createApp(dto.appKey);
    // 审计：新建应用
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app.create',
      resourceType: 'app',
      resourceId: dto.appKey,
      ...getRequestMeta(req),
    });
    return result;
  }

  @Patch(':appKey')
  @ApiOperation({
    summary: '修改应用标识（重命名目录并迁移全部关联记录）',
  })
  async rename(
    @Param('appKey') appKey: string,
    @Body() dto: RenameAppDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.renameApp(appKey, dto.newAppKey);
    // 审计：重命名应用
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app.rename',
      resourceType: 'app',
      resourceId: appKey,
      details: { appKey, newAppKey: dto.newAppKey },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Delete(':appKey')
  @ApiOperation({
    summary: '删除应用（删除目录、全部版本/事件记录与文件索引，不可恢复）',
  })
  async remove(
    @Param('appKey') appKey: string,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.deleteApp(appKey);
    // 审计：删除应用（高危硬删除操作）
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app.delete',
      resourceType: 'app',
      resourceId: appKey,
      ...getRequestMeta(req),
    });
    return result;
  }
}
