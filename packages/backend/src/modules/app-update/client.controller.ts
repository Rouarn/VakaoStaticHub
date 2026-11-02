/**
 * APP 更新客户端接口（公开，无需登录）
 * 版本检查 / APK 下载（支持 Range 断点续传）/ 事件上报
 */

import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import { Public } from '#/common/decorators/public.decorator.js';
import { serveApkFile } from '#/infra/storage/file-serve.util.js';
import { AppUpdateService } from './app-update.service.js';
import { AppUpdateStatsService } from './app-update-stats.service.js';
import { CheckUpdateQueryDto } from './dto/check-update-query.dto.js';
import { ReportEventDto } from './dto/report-event.dto.js';

@ApiTags('APP 更新（客户端）')
@Controller('app-updates')
@UseGuards(JwtAuthGuard)
@Public()
export class ClientController {
  constructor(
    private readonly service: AppUpdateService,
    private readonly statsService: AppUpdateStatsService,
  ) {}

  @Get('check')
  @ApiOperation({ summary: '版本检查：以客户端上报 versionCode 为判定基准' })
  async check(@Query() query: CheckUpdateQueryDto, @Req() req: Request) {
    return await this.service.checkUpdate(query, req);
  }

  @Get('download/:id')
  @ApiOperation({ summary: '下载 APK 安装包（支持 HTTP Range 断点续传）' })
  @ApiParam({ name: 'id', description: '版本记录 ID' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const record = await this.service.getDownloadable(id);
    const fullPath = this.service.resolveApkPath(record);
    try {
      await serveApkFile(fullPath, req, res, {
        etag: `"apk-${record.id}-${record.checksum.slice(0, 16)}"`,
      });
    } catch {
      // 响应可能已开始写出，此处仅在 stat/读流失败（文件缺失）时抛出
      if (!res.headersSent) {
        throw new NotFoundException('安装包文件缺失');
      }
    }
  }

  @Post('report')
  @ApiOperation({ summary: '升级事件上报（失败客户端无感）' })
  async report(@Body() dto: ReportEventDto) {
    return await this.statsService.reportEvent(dto);
  }
}
