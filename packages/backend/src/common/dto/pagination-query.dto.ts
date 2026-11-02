import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * 通用分页查询参数
 */
export class PaginationQueryDto {
  /** 页码，从 1 开始 */
  @ApiProperty({ description: '页码', default: 1, required: false })
  @Transform(({ value }) => (value == null ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page: number = 1;

  /** 每页数量，最大 100 */
  @ApiProperty({ description: '每页数量', default: 10, required: false })
  @Transform(({ value }) => (value == null ? 10 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;
}
