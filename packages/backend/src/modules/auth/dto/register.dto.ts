/**
 * 注册数据传输对象
 * 定义新用户注册请求的参数结构与校验规则
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { UserRole } from '@vakao/shared';

/**
 * 注册 DTO 类
 * 用户名仅允许字母、数字、下划线和连字符，密码至少 6 位
 */
export class RegisterDto {
  /** 用户名 */
  @ApiProperty({ description: '用户名', example: 'admin' })
  @IsString()
  @Length(3, 32, { message: '用户名长度需在 3~32 个字符之间' })
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: '用户名仅支持字母、数字、下划线和连字符',
  })
  username!: string;

  /** 密码 */
  @ApiProperty({ description: '密码', example: '123456' })
  @IsString()
  @Length(6, 64, { message: '密码长度需在 6~64 个字符之间' })
  password!: string;

  /** 角色：默认 user；仅管理员可以创建 admin */
  @ApiPropertyOptional({
    description: '角色：admin 管理员 / user 普通用户，默认 user',
    enum: ['admin', 'user'],
  })
  @IsOptional()
  @IsIn(['admin', 'user'], { message: '角色仅支持 admin / user' })
  role?: UserRole;
}
