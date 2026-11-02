/**
 * 编辑分享链接 DTO
 * 所有字段可选：不传表示保持不变；expiresAt/maxAccesses/password 传 null 表示清除限制/密码
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UpdateShareLinkParams } from '@vakao/shared';

export class UpdateShareLinkDto implements UpdateShareLinkParams {
  @ApiPropertyOptional({ description: '后台备注；null 表示清空' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '备注最长 255 个字符' })
  remark?: string | null;

  @ApiPropertyOptional({
    description: '绝对过期时间戳（毫秒）；null 表示永久有效',
  })
  @IsOptional()
  @IsInt()
  expiresAt?: number | null;

  @ApiPropertyOptional({ description: '新访问密码；null 表示清除密码' })
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '密码最长 64 个字符' })
  password?: string | null;

  @ApiPropertyOptional({ description: '最大打开次数；null 表示不限制' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxAccesses?: number | null;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
