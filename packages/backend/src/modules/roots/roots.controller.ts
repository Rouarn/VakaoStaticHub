import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import {
  BrowseBoundsResultDto,
  BrowseDirectoriesQueryDto,
  BrowseDirectoriesResultDto,
} from './dto/browse-directories.dto.js';
import {
  CreateResourceRootDto,
  UpdateResourceRootDto,
} from './dto/resource-root.dto.js';
import { RootsService } from './roots.service.js';

@ApiTags('资源根目录管理')
@Controller('roots')
@UseGuards(JwtAuthGuard)
export class RootsController {
  constructor(private readonly service: RootsService) {}

  @Get()
  @ApiOperation({ summary: '获取存储根目录列表' })
  getRoots() {
    return this.service.getRoots();
  }

  @Post()
  @ApiOperation({ summary: '添加存储根目录（自动创建目录）' })
  async addRoot(@Body() body: CreateResourceRootDto) {
    return await this.service.addRoot(body);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除存储根目录（仅允许删除空目录）' })
  @ApiParam({ name: 'id', description: '根目录 ID' })
  async removeRoot(@Param('id') id: string) {
    return await this.service.removeRoot(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新存储根目录（名称 / 路径）' })
  @ApiParam({ name: 'id', description: '根目录 ID' })
  async updateRoot(
    @Param('id') id: string,
    @Body() body: UpdateResourceRootDto,
  ) {
    return await this.service.updateRoot(id, body);
  }

  @Get('browse/bounds')
  @ApiOperation({
    summary: '允许浏览与创建根目录的边界（主目录 / 根目录父级 / 白名单）',
  })
  @ApiOkResponse({ type: BrowseBoundsResultDto })
  async browseBounds() {
    return {
      bounds: await this.service.getBrowseBounds(),
      roots: await this.service.getRootShortcuts(),
    };
  }

  @Get('browse')
  @ApiOperation({
    summary: '浏览服务器目录（仅目录，用于新建根目录时选择路径）',
  })
  @ApiOkResponse({ type: BrowseDirectoriesResultDto })
  @ApiResponse({
    status: 400,
    description: '路径不是绝对路径 / 含 `..` / 无权限读取 / 不是目录',
  })
  @ApiResponse({ status: 403, description: '目录超出允许浏览的安全边界' })
  @ApiResponse({ status: 404, description: '目录不存在' })
  async browse(@Query() query: BrowseDirectoriesQueryDto) {
    return await this.service.browseDirectories(query.path);
  }
}
