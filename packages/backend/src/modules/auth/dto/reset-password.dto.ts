/**
 * 管理员重置他人密码 DTO
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: '新密码', example: '123456' })
  @IsString()
  @Length(6, 64, { message: '密码长度需在 6~64 个字符之间' })
  newPassword!: string;
}
