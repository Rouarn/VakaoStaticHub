/**
 * 新建资源分类 DTO
 * 分类名即根目录下一级子目录名，禁止携带路径段，防止路径穿越
 */

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: '分类名（仅目录名，不能包含路径分隔符）' })
  @IsString()
  @IsNotEmpty({ message: '分类名不能为空' })
  @MaxLength(255, { message: '分类名最长 255 个字符' })
  @Matches(/^[^\\/]+$/, { message: '分类名不能包含路径分隔符' })
  name!: string;
}
