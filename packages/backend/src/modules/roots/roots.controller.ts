import {
  BadRequestException,
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
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
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

  @Get('system/directories')
  @ApiOperation({ summary: '浏览服务器系统目录' })
  @ApiQuery({ name: 'path', required: false, description: '要浏览的目录路径' })
  async browseDirectories(@Query('path') path?: string) {
    try {
      return await this.service.browseDirectories(path);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }
}
