/**
 * 监控指标控制器
 * 提供系统运行指标查询接口，需 JWT 认证后访问
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import { MetricsService } from './metrics.service.js';

@ApiTags('监控指标')
@Controller('metrics')
@UseGuards(JwtAuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /** 获取系统运行指标（运行时长、内存、存储、分享、应用、升级事件、用户与 QPS） */
  @Get()
  @ApiOperation({ summary: '获取系统运行指标' })
  async getMetrics() {
    return await this.metricsService.getMetrics();
  }
}
