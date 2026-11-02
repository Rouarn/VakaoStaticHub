/**
 * 分享链接列表查询 DTO（服务端分页 + 关键字 + 状态筛选）
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { ShareLinkStatus, ShareListQuery } from '@vakao/shared';

export class ListShareLinksQueryDto implements ShareListQuery {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({
    description: '关键字：token / 文件路径 / 分类 / 备注',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  q?: string;

  @ApiPropertyOptional({
    description: '状态筛选：active / expired / exhausted / disabled',
    enum: ['active', 'expired', 'exhausted', 'disabled'],
  })
  @IsOptional()
  @IsIn(['active', 'expired', 'exhausted', 'disabled'])
  status?: ShareLinkStatus;
}
