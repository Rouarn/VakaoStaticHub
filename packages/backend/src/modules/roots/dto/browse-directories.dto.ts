/**
 * 服务器目录浏览 DTO
 *
 * 契约来源与前端共享：字段定义与 @vakao/shared 的
 * BrowseDirectoriesResult / BrowseDirectoryEntry / ROOT_BROWSE_MAX_ENTRIES 一一对应。
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 查询参数：目标目录绝对路径；省略时从用户主目录开始 */
export class BrowseDirectoriesQueryDto {
  @ApiPropertyOptional({
    description:
      '要浏览的目录绝对路径；省略时默认为当前运行用户的主目录。' +
      '不允许相对路径与 `..`，且必须落在允许浏览的范围内',
    example: '/Users/woyuxiaji/Documents',
  })
  @IsOptional()
  @IsString()
  path?: string;
}

export class BrowseDirectoryEntryDto {
  @ApiProperty({ description: '目录名（不含路径）', example: 'Documents' })
  name!: string;

  @ApiProperty({
    description: '目录绝对路径',
    example: '/Users/woyuxiaji/Documents',
  })
  path!: string;
}

export class BrowseDirectoriesResultDto {
  @ApiProperty({
    description: '当前目录绝对路径（符号链接已解析为真实路径）',
    example: '/Users/woyuxiaji',
  })
  path!: string;

  @ApiProperty({
    description: '上级目录；已到达允许浏览的边界时为 null',
    example: '/Users',
    nullable: true,
  })
  parent!: string | null;

  @ApiProperty({
    description: '子目录列表（不包含文件与符号链接）',
    type: [BrowseDirectoryEntryDto],
  })
  entries!: BrowseDirectoryEntryDto[];

  @ApiProperty({
    description: '是否因单次条目上限（500）被截断',
    example: false,
  })
  truncated!: boolean;

  @ApiProperty({ description: '截断前扫描到的子目录总数', example: 12 })
  total!: number;
}

export class BrowseBoundDto {
  @ApiProperty({
    description: '边界绝对路径（realpath 归一后）',
    example: '/www/wwwroot',
  })
  path!: string;

  @ApiProperty({ description: '来源说明', example: '白名单' })
  label!: string;

  @ApiProperty({
    description: '来源类型',
    enum: ['root-parent', 'whitelist', 'home'],
    example: 'whitelist',
  })
  source!: 'root-parent' | 'whitelist' | 'home';
}

export class BrowseShortcutDto {
  @ApiProperty({
    description: '根目录真实绝对路径',
    example: '/www/wwwroot/vakao-static-hub/media',
  })
  path!: string;

  @ApiProperty({ description: '根目录显示名称', example: '媒体资源' })
  label!: string;

  @ApiProperty({ description: '根目录 ID', example: 'media' })
  rootId!: string;
}

export class BrowseBoundsResultDto {
  @ApiProperty({
    description: '允许浏览与创建根目录的边界列表（按来源排序）',
    type: [BrowseBoundDto],
  })
  bounds!: BrowseBoundDto[];

  @ApiProperty({
    description: '已配置根目录（作为快捷入口，可直接跳转到该目录）',
    type: [BrowseShortcutDto],
  })
  roots!: BrowseShortcutDto[];
}
