/**
 * 删除资源分类查询参数
 * recursive=false（默认）时分类必须为空；显式传 true 才会连同文件一起删除
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class DeleteCategoryQueryDto {
  @ApiPropertyOptional({
    description: '是否递归删除非空分类（默认 false，非空时返回 409）',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  recursive?: boolean;
}
