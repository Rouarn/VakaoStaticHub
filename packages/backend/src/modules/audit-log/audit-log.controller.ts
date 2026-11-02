/**
 * 审计日志控制器
 * 提供操作审计日志的分页查询接口（需登录）
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import { AuditLogService } from './audit-log.service.js';
import { QueryAuditLogDto } from './dto/query-audit-log.dto.js';

@ApiTags('审计日志')
@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({
    summary: '分页查询操作审计日志（可按动作/资源类型/用户名/时间范围筛选）',
  })
  async list(@Query() query: QueryAuditLogDto) {
    return await this.auditLogService.findAll(query);
  }
}
