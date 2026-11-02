import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { JwtAuthGuard } from '#/common/guards/jwt-auth.guard.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import {
  CreateResourceRootDto,
  UpdateResourceRootDto,
} from './dto/resource-root.dto.js';
import { FilesService } from '../files/files.service.js';
import type { ResourceRoot } from '@vakao/shared';

@ApiTags('资源根目录管理')
@Controller('roots')
@UseGuards(JwtAuthGuard)
export class RootsController {
  constructor(
    private readonly resourceRoots: ResourceRootsService,
    private readonly filesService: FilesService,
  ) {}

  /** 相对路径按进程工作目录解析，绝对路径原样保留 */
  private resolvePath(path: string): string {
    return isAbsolute(path) ? path : resolve(process.cwd(), path);
  }

  private assertRootId(id: string) {
    if (id === 'roots') {
      throw new BadRequestException('非法的根目录 ID');
    }
  }

  /** 递归统计真实文件数量（跳过隐藏项与空目录） */
  private async countFiles(dir: string): Promise<number> {
    const entries = await readdir(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        count += await this.countFiles(resolve(dir, entry.name));
      } else if (entry.isFile()) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 校验并创建目录：
   * - 路径不存在 → 递归创建
   * - 已存在但不是目录 → 400
   * - 权限不足 → 400 并给出可读原因（不伪造成功）
   */
  private async ensureDirectory(path: string) {
    const fullPath = this.resolvePath(path);
    try {
      const info = await stat(fullPath);
      if (!info.isDirectory()) {
        throw new BadRequestException(`路径已存在且不是目录：${path}`);
      }
      return fullPath;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new BadRequestException(
          `无法访问路径 ${path}（${code ?? '未知错误'}），请检查权限或路径是否合法`,
        );
      }
    }

    try {
      await mkdir(fullPath, { recursive: true });
      return fullPath;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new BadRequestException(
        code === 'EACCES' || code === 'EPERM'
          ? `没有写入权限，无法创建目录：${path}`
          : `创建目录失败：${path}（${code ?? '未知错误'}）`,
      );
    }
  }

  private assertPathUnique(path: string, excludeId?: string) {
    const target = this.resolvePath(path);
    const duplicated = this.resourceRoots
      .getRoots()
      .find(
        (root) =>
          root.id !== excludeId && this.resolvePath(root.path) === target,
      );
    if (duplicated) {
      throw new ConflictException(
        `根路径已被根目录「${duplicated.name}」(${duplicated.id}) 使用`,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: '获取存储根目录列表' })
  getRoots() {
    return this.resourceRoots.getRoots();
  }

  @Post()
  @ApiOperation({ summary: '添加存储根目录（自动创建目录）' })
  async addRoot(@Body() body: CreateResourceRootDto) {
    this.assertRootId(body.id);
    const id = body.id.trim();
    const name = body.name.trim();
    const path = body.path.trim();
    if (!id || !name || !path) {
      throw new BadRequestException('根目录 ID、名称、路径均不能为空');
    }
    if (this.resourceRoots.getRoot(id)) {
      throw new ConflictException(`根目录 ID 已存在：${id}`);
    }
    this.assertPathUnique(path);

    // 先落盘再写配置，避免配置里出现不可用的根目录
    await this.ensureDirectory(path);

    const root: ResourceRoot = { id, name, path };
    await this.resourceRoots.addRoot(root);
    return this.resourceRoots.getRoots();
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除存储根目录（仅允许删除空目录）' })
  @ApiParam({ name: 'id', description: '根目录 ID' })
  async removeRoot(@Param('id') id: string) {
    this.assertRootId(id);
    const root = this.resourceRoots.getRoot(id);
    if (!root) {
      throw new NotFoundException(`根目录不存在：${id}`);
    }
    if (this.resourceRoots.getRoots().length <= 1) {
      throw new ConflictException('至少需要保留一个根目录，无法删除最后一个');
    }

    const fullPath = this.resolvePath(root.path);
    let fileCount = 0;
    try {
      // 只统计真实文件（递归进入分类目录），忽略 .DS_Store 等隐藏项：
      // 空分类目录本身不构成数据，否则「删除文件后仍无法删除根目录」会变成死路
      fileCount = await this.countFiles(fullPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new BadRequestException(
          `无法读取根目录 ${root.path}（${code ?? '未知错误'}）`,
        );
      }
    }

    if (fileCount > 0) {
      throw new ConflictException(
        `根目录下仍有 ${fileCount} 个文件（含分类目录内），请先清空后再删除`,
      );
    }

    await this.resourceRoots.removeRoot(id);
    return { success: true };
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新存储根目录（名称 / 路径）' })
  @ApiParam({ name: 'id', description: '根目录 ID' })
  async updateRoot(
    @Param('id') id: string,
    @Body() body: UpdateResourceRootDto,
  ) {
    this.assertRootId(id);
    if (!this.resourceRoots.getRoot(id)) {
      throw new NotFoundException(`根目录不存在：${id}`);
    }

    const updates: Partial<Omit<ResourceRoot, 'id'>> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('根目录名称不能为空');
      updates.name = name;
    }
    if (body.path !== undefined) {
      const path = body.path.trim();
      if (!path) throw new BadRequestException('根目录路径不能为空');
      this.assertPathUnique(path, id);

      const oldPath = this.resolvePath(this.resourceRoots.getRoot(id)!.path);
      const newPath = this.resolvePath(path);
      if (newPath !== oldPath) {
        // 旧目录已有内容时不允许改路径：避免配置切换后旧文件“凭空消失”
        try {
          const entries = await readdir(oldPath);
          if (entries.filter((entry) => !entry.startsWith('.')).length > 0) {
            throw new ConflictException(
              '该根目录下已有文件/分类，不支持修改物理路径；请新建一个根目录',
            );
          }
        } catch (error) {
          if (error instanceof ConflictException) throw error;
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            throw new BadRequestException(
              `无法读取旧根目录（${code ?? '未知错误'}）`,
            );
          }
        }
        await this.ensureDirectory(path);
      }
      updates.path = path;
    }

    await this.resourceRoots.updateRoot(id, updates);
    return this.resourceRoots.getRoots();
  }

  @Get('system/directories')
  @ApiOperation({ summary: '浏览服务器系统目录' })
  @ApiQuery({ name: 'path', required: false, description: '要浏览的目录路径' })
  async browseDirectories(@Query('path') path?: string) {
    try {
      return await this.filesService.listSystemDirectories(path);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }
}
