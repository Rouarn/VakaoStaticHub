/**
 * 创建分享链接 DTO
 * 定义创建分享链接的请求参数结构
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 创建分享链接 DTO
 * 支持过期时间和访问次数限制
 */
export class CreateShareLinkDto {
  /** 资源根目录 ID */
  @ApiProperty({ description: '资源根目录 ID' })
  @IsString()
  rootId!: string;

  /** 分类目录名 */
  @ApiProperty({ description: '分类目录名' })
  @IsString()
  category!: string;

  /** 文件相对路径（单文件分享时使用） */
  @ApiProperty({ description: '文件相对路径' })
  @IsString()
  filePath!: string;

  /** 分享类型：file 单文件 / collection 多文件 */
  @ApiPropertyOptional({ description: '分享类型，默认 file' })
  @IsOptional()
  @IsIn(['file', 'collection'])
  shareType?: 'file' | 'collection';

  /** 多文件相对路径列表，shareType='collection' 时必填 */
  @ApiPropertyOptional({ description: '多文件相对路径列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];

  /** 后台备注 */
  @ApiPropertyOptional({ description: '后台备注（仅管理端可见）' })
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: '备注最长 255 个字符' })
  remark?: string;

  /** 有效期（毫秒），不传则永不过期 */
  @ApiPropertyOptional({ description: '有效期（毫秒），不传则永不过期' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  expiresInMs?: number;

  /** 最大访问次数，不传则不限制 */
  @ApiPropertyOptional({ description: '最大访问次数，不传则不限制' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxAccesses?: number;

  /** 访问密码，不传则不设置密码 */
  @ApiPropertyOptional({ description: '访问密码，不传则不设置密码' })
  @IsOptional()
  @IsString()
  password?: string;
}
