/**
 * APP 更新管理端接口（JWT 鉴权）
 * 上传 APK、版本 CRUD、发布/灰度、强更开关、下架止血
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AppUpdateService } from './app-update.service.js';
import { AppUpdateStatsService } from './app-update-stats.service.js';
import { ApkUploadInterceptor } from './apk-upload.interceptor.js';
import { CreateVersionDto } from './dto/create-version.dto.js';
import { ForceUpdateDto } from './dto/force-update.dto.js';
import { FunnelStatsQueryDto } from './dto/funnel-stats-query.dto.js';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto.js';
import { PublishVersionDto } from './dto/publish-version.dto.js';
import { UpdateVersionDto } from './dto/update-version.dto.js';
import { CurrentUser } from '#/common/decorators/current-user.decorator.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { getRequestMeta } from '#/utils/request-meta.util.js';

@ApiTags('APP 更新（管理端）')
@ApiBearerAuth()
@Controller('app-updates/versions')
@UseGuards(JwtAuthGuard)
export class AppUpdateAdminController {
  constructor(
    private readonly service: AppUpdateService,
    private readonly statsService: AppUpdateStatsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @ApiOperation({
    summary: '上传 APK 并创建草稿版本（自动计算大小与 SHA-256）',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'appKey', 'versionName', 'versionCode'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'APK 安装包' },
        appKey: {
          type: 'string',
          example: 'xiaolv',
          description: '应用标识（需先创建应用）',
        },
        versionName: { type: 'string', example: '1.0.1' },
        versionCode: { type: 'string', example: '101' },
        updateLog: { type: 'string', description: '更新说明，支持换行' },
        remark: { type: 'string' },
      },
    },
  })
  @UseInterceptors(ApkUploadInterceptor())
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateVersionDto,
  ) {
    return await this.service.createVersion(file, dto);
  }

  @Get()
  @ApiOperation({ summary: '分页版本列表（可按状态/渠道筛选）' })
  async list(@Query() query: ListVersionsQueryDto) {
    return await this.service.listVersions(query);
  }

  @Get('stats/funnel')
  @ApiOperation({ summary: '升级漏斗统计（按版本聚合各事件转化率）' })
  async funnelStats(@Query() query: FunnelStatsQueryDto) {
    const endTime = query.endTime ?? Date.now();
    const startTime = query.startTime ?? endTime - 30 * 24 * 60 * 60 * 1000;
    return await this.statsService.getFunnelStats(
      query.appKey,
      startTime,
      endTime,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '版本详情' })
  @ApiParam({ name: 'id' })
  async detail(@Param('id', ParseIntPipe) id: number) {
    return await this.service.getVersion(id);
  }

  @Get(':id/rollback-candidates')
  @ApiOperation({
    summary: '回滚候选（服务端按同应用同平台的历史可恢复版本计算）',
  })
  @ApiParam({ name: 'id' })
  async rollbackCandidates(@Param('id', ParseIntPipe) id: number) {
    return await this.service.listRollbackCandidates(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑元数据（仅草稿/已下架可改）' })
  @ApiParam({ name: 'id' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVersionDto,
  ) {
    return await this.service.updateVersion(id, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布版本（full 全量 / gray 灰度，带门禁校验）' })
  @ApiParam({ name: 'id' })
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishVersionDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.publishVersion(id, dto);
    // 审计：发布版本
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app_version.publish',
      resourceType: 'app_version',
      resourceId: String(id),
      details: {
        appKey: result.appKey,
        versionName: result.versionName,
        versionCode: result.versionCode,
        mode: dto.mode,
        grayPercent: dto.mode === 'gray' ? dto.grayPercent : undefined,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Put(':id/force')
  @ApiOperation({ summary: '远程修改强更开关（逃生口，无需重新发版）' })
  @ApiParam({ name: 'id' })
  async setForce(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ForceUpdateDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.setForce(id, dto);
    // 审计：修改强更开关
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app_version.force_update',
      resourceType: 'app_version',
      resourceId: String(id),
      details: {
        forceUpdate: dto.forceUpdate,
        minVersionCode: dto.minVersionCode,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Post(':id/offline')
  @ApiOperation({ summary: '一键下架（止血开关，文件保留）' })
  @ApiParam({ name: 'id' })
  async offline(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.offline(id);
    // 审计：下架版本
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app_version.offline',
      resourceType: 'app_version',
      resourceId: String(id),
      details: {
        appKey: result.appKey,
        versionName: result.versionName,
        versionCode: result.versionCode,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Post(':id/rollback')
  @ApiOperation({
    summary: '一键回滚：下架该版本并恢复上一个全量版本在线',
  })
  @ApiParam({ name: 'id' })
  async rollback(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.rollback(id);
    // 审计：回滚版本
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app_version.rollback',
      resourceType: 'app_version',
      resourceId: String(id),
      details: {
        rolledBack: result.rolledBack,
        restored: result.restored,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      '物理删除版本（仅草稿/已下架，删除 APK 文件及全部关联记录，不可恢复）',
  })
  @ApiParam({ name: 'id' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.remove(id);
    // 审计：删除版本
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'app_version.delete',
      resourceType: 'app_version',
      resourceId: String(id),
      details: { eventCount: result.eventCount, fileCount: result.fileCount },
      ...getRequestMeta(req),
    });
    return result;
  }
}
