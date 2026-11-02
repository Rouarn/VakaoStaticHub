/**
 * 创建分享链接 DTO
 * 定义创建分享链接的请求参数结构
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 相对路径：禁止绝对路径、反斜杠与 `..` 路径穿越 */
export const SAFE_REL_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/;

/** 资源根目录 ID：仅允许字母、数字、下划线、连字符 */
export const SAFE_ROOT_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * 创建分享链接 DTO
 * 支持过期时间和访问次数限制
 */
export class CreateShareLinkDto {
  /** 资源根目录 ID */
  @ApiProperty({ description: '资源根目录 ID' })
  @IsString()
  @Matches(SAFE_ROOT_ID_RE, { message: '资源根目录 ID 含非法字符' })
  rootId!: string;

  /** 分类目录名 */
  @ApiProperty({ description: '分类目录名' })
  @IsString()
  @Matches(SAFE_REL_PATH_RE, { message: '分类名不合法（禁止绝对路径与 ..）' })
  category!: string;

  /** 分享文件的相对路径列表（长度 1..200，1 个即单文件分享） */
  @ApiProperty({ description: '分享文件的相对路径列表', minItems: 1 })
  @IsArray()
  @ArrayMinSize(1, { message: '请选择至少一个文件' })
  @ArrayMaxSize(200, { message: '一次最多分享 200 个文件' })
  @IsString({ each: true })
  @Matches(SAFE_REL_PATH_RE, {
    each: true,
    message: '文件路径不合法（禁止绝对路径与 ..）',
  })
  filePaths!: string[];

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
