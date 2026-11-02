import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { ListVersionsQuery } from '@vakao/shared';

export class ListVersionsQueryDto implements ListVersionsQuery {
  @ApiPropertyOptional({ description: '页码', example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页数量', example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    description: '状态筛选：0 草稿 / 1 灰度 / 2 全量 / 3 下架',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1, 2, 3])
  status?: number;

  @ApiPropertyOptional({ description: '应用标识筛选', example: 'xiaolv' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'appKey 仅允许字母数字与 _ -',
  })
  appKey?: string;

  @ApiPropertyOptional({ description: '平台筛选，如 android' })
  @IsOptional()
  @IsString()
  @Length(1, 16)
  platform?: string;
}
