/**
 * 重复文件扫描查询参数
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { DuplicateFilesQuery } from '@vakao/shared';

export class DuplicateFilesQueryDto implements DuplicateFilesQuery {
  @ApiPropertyOptional({ description: '限定资源根目录 ID' })
  @IsOptional()
  @IsString()
  rootId?: string;

  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页重复组数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
