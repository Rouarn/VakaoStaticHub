import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response, Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { FilesService } from './files.service.js';
import { BatchDeleteDto } from './dto/batch-delete.dto.js';
import { BatchMoveDto } from './dto/batch-move.dto.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { DeleteCategoryQueryDto } from './dto/delete-category-query.dto.js';
import { DuplicateFilesQueryDto } from './dto/duplicate-files-query.dto.js';
import { ListFilesQueryDto } from './dto/list-files-query.dto.js';
import { RenameFileDto } from './dto/rename-file.dto.js';
import { RenameCategoryDto } from './dto/rename-category.dto.js';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { ImageProcessorService } from './image-processor.service.js';
import { getMimeType } from './utils/mime-types.js';
import { ConfigurableFilesInterceptor } from '#/common/interceptors/configurable-files.interceptor.js';
import { ConfigurableChunkFileInterceptor } from '#/common/interceptors/configurable-chunk-file.interceptor.js';
import { serveStaticFile } from '#/utils/file-serve.util.js';
import { FileIndexService } from './file-index.service.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CurrentUser } from '#/common/decorators/current-user.decorator.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { getRequestMeta } from '#/utils/request-meta.util.js';

@ApiTags('文件管理')
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(
    private readonly service: FilesService,
    private readonly imageProcessor: ImageProcessorService,
    private readonly fileIndexService: FileIndexService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditLogService: AuditLogService,
  ) {}

  // 单段静态路由，不会与 ':rootId/categories'、':rootId/:category' 等两段路由冲突
  @Get('config')
  @ApiOperation({ summary: '获取文件管理下发配置（默认分类等）' })
  getFileConfig() {
    return this.service.getFileConfig();
  }

  // 两段静态路由，必须声明在 ':rootId/:category' 之前避免被通配匹配
  @Get('stats/usage')
  @ApiOperation({ summary: '存储用量统计（按资源根/分类聚合）' })
  async getUsageStats() {
    return await this.service.getUsageStats();
  }

  // 单段静态路由，按内容哈希分组检测重复文件（可对存量文件惰性补算哈希）
  @Get('duplicates')
  @ApiOperation({ summary: '重复文件检测（按内容 SHA-256 分组，服务端分页）' })
  async getDuplicates(@Query() query: DuplicateFilesQueryDto) {
    return await this.service.getDuplicateFiles(
      query.rootId,
      query.page,
      query.pageSize,
    );
  }

  @Get(':rootId/categories')
  @ApiOperation({ summary: '获取指定根目录下的分类列表' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  async listCategories(@Param('rootId') rootId: string) {
    return await this.service.listCategories(rootId);
  }

  @Post(':rootId/categories')
  @ApiOperation({ summary: '新建空分类（根目录下的一级子目录）' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  async createCategory(
    @Param('rootId') rootId: string,
    @Body() dto: CreateCategoryDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.createCategory(rootId, dto.name);
    // 审计：新建分类
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'category.create',
      resourceType: 'category',
      resourceId: `${rootId}/${result.category}`,
      details: { rootId, category: result.category },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Delete(':rootId/categories/:category')
  @ApiOperation({
    summary: '删除分类（默认要求为空，recursive=true 时连同文件一起删除）',
  })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiParam({ name: 'category', description: '一级分类目录名' })
  async deleteCategory(
    @Param('rootId') rootId: string,
    @Param('category') category: string,
    @Query() query: DeleteCategoryQueryDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.deleteCategory(
      rootId,
      category,
      query.recursive ?? false,
    );
    // 审计：删除分类
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'category.delete',
      resourceType: 'category',
      resourceId: `${rootId}/${category}`,
      details: {
        rootId,
        category,
        recursive: query.recursive ?? false,
        removedEntries: result.removedEntries,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  // 注意：该静态段路由必须声明在通配路由 @Patch(':rootId/:category/*path') 之前，
  // 否则 /files/:rootId/categories/:category 会被通配路由抢先匹配
  @Patch(':rootId/categories/:category')
  @ApiOperation({
    summary: '重命名分类（目录改名，文件索引与分享链接同步迁移）',
  })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiParam({ name: 'category', description: '当前分类目录名' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['newCategory'],
      properties: {
        newCategory: {
          type: 'string',
          description: '新分类目录名（不含路径分隔符）',
        },
      },
    },
  })
  async renameCategory(
    @Param('rootId') rootId: string,
    @Param('category') category: string,
    @Body() dto: RenameCategoryDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.renameCategory(
      rootId,
      category,
      dto.newCategory,
    );
    // 审计：重命名分类
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'category.rename',
      resourceType: 'category',
      resourceId: `${rootId}/${category}`,
      details: { rootId, category, newCategory: dto.newCategory },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Get(':rootId/:category')
  @ApiOperation({ summary: '分页获取文件列表' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiParam({ name: 'category', description: '分类目录名' })
  async listFiles(
    @Param('rootId') rootId: string,
    @Param('category') category: string,
    @Query() query: ListFilesQueryDto,
  ) {
    if (!category) throw new BadRequestException('category is required');
    return await this.service.listFilesPaged(rootId, category, query);
  }

  @Post('sync')
  @ApiOperation({ summary: '强制同步文件索引（重新扫描磁盘并刷新数据库）' })
  async syncFileIndex() {
    await this.fileIndexService.syncAll();
    this.eventEmitter.emit('files.index.resynced');
    return { message: 'ok' };
  }

  @Post('batch-delete')
  @ApiOperation({ summary: '批量删除文件' })
  async batchDelete(
    @Body() dto: BatchDeleteDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.batchDeleteFiles(
      dto.rootId,
      dto.category,
      dto.paths,
    );
    // 审计：批量删除文件
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'file.batch_delete',
      resourceType: 'file',
      details: {
        rootId: dto.rootId,
        category: dto.category,
        paths: dto.paths,
        batch: true,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Post('batch-move')
  @ApiOperation({ summary: '批量移动文件到另一个分类' })
  async batchMove(
    @Body() dto: BatchMoveDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.batchMoveFiles(
      dto.rootId,
      dto.category,
      dto.paths,
      dto.targetCategory,
    );
    // 审计：批量移动文件
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'file.batch_move',
      resourceType: 'file',
      details: {
        rootId: dto.rootId,
        category: dto.category,
        targetCategory: dto.targetCategory,
        paths: dto.paths,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  // ==================== 大文件分片上传 ====================
  // 注意：分片上传路由必须声明在 ':rootId/upload' 之前，否则会被通配匹配

  @Post('upload/init')
  @ApiOperation({ summary: '初始化分片上传' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['rootId', 'category', 'filename', 'size', 'chunkSize'],
      properties: {
        rootId: { type: 'string' },
        category: { type: 'string' },
        filename: { type: 'string' },
        size: { type: 'number' },
        chunkSize: { type: 'number' },
      },
    },
  })
  async initChunkUpload(
    @Body()
    body: {
      rootId: string;
      category: string;
      filename: string;
      size: number;
      chunkSize: number;
    },
    @CurrentUser() currentUser: { userId: number; username: string },
  ) {
    return await this.service.initChunkUpload(
      body.rootId,
      body.category,
      body.filename,
      body.size,
      body.chunkSize,
      currentUser.userId,
    );
  }

  @Post('upload/chunk')
  @ApiOperation({ summary: '上传分片' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(ConfigurableChunkFileInterceptor)
  async uploadChunk(
    @Query('uploadId') uploadId: string,
    @Query('index') index: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No chunk uploaded');
    }
    return await this.service.saveChunk(
      uploadId,
      parseInt(index, 10),
      file.buffer,
    );
  }

  @Post('upload/complete')
  @ApiOperation({ summary: '合并分片完成上传' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['uploadId', 'rootId', 'category', 'filename', 'size'],
      properties: {
        uploadId: { type: 'string' },
        rootId: { type: 'string' },
        category: { type: 'string' },
        filename: { type: 'string' },
        size: { type: 'number' },
      },
    },
  })
  async completeChunkUpload(
    @Body()
    body: {
      uploadId: string;
      rootId: string;
      category: string;
      filename: string;
      size: number;
    },
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.service.completeChunkUpload(
      body.uploadId,
      body.rootId,
      body.category,
      body.filename,
      body.size,
    );
    // 审计：分片上传合并完成
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'file.upload',
      resourceType: 'file',
      details: {
        rootId: body.rootId,
        category: body.category,
        filename: body.filename,
        size: body.size,
        chunked: true,
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Post('upload/cancel')
  @ApiOperation({ summary: '取消分片上传并清理临时文件' })
  async cancelChunkUpload(@Body() body: { uploadId: string }) {
    return await this.service.cancelChunkUpload(body.uploadId);
  }

  @Post(':rootId/upload')
  @ApiOperation({ summary: '上传文件' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        category: { type: 'string', description: '分类目录（子目录）' },
      },
    },
  })
  @UseInterceptors(ConfigurableFilesInterceptor)
  async uploadFiles(
    @Param('rootId') rootId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('category') category: string,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }
    const result = await this.service.batchSaveFiles(
      rootId,
      category || '',
      files,
    );
    // 审计：上传文件
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'file.upload',
      resourceType: 'file',
      details: {
        rootId,
        category: category || '',
        count: files.length,
        files: files.map((f) => ({
          name: f.originalname,
          size: f.size,
        })),
      },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Public()
  // 图片墙/文件列表会并发加载大量缩略图，属于幂等可缓存的静态资源请求，
  // 不应占用全局限流预算（默认每 IP 每分钟 300 次），否则翻页即触发 429
  @SkipThrottle()
  @Get(':rootId/:category/*path')
  @ApiOperation({ summary: '下载或预览文件' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiParam({ name: 'category', description: '分类目录名' })
  @ApiParam({ name: 'path', description: '文件相对路径' })
  @ApiQuery({ name: 'download', required: false, description: '是否强制下载' })
  @ApiQuery({ name: 'w', required: false, description: '图片宽度' })
  @ApiQuery({ name: 'h', required: false, description: '图片高度' })
  @ApiQuery({ name: 'q', required: false, description: '图片质量 (0-100)' })
  @ApiQuery({ name: 'format', required: false, description: '输出格式' })
  async serveFile(
    @Param('rootId') rootId: string,
    @Param('category') category: string,
    @Param('path') rest: string[] | string,
    @Query('download') isDownload: string | undefined,
    @Query('w') w: string | undefined,
    @Query('h') h: string | undefined,
    @Query('q') q: string | undefined,
    @Query('format') format: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!category) throw new BadRequestException('category is required');

    const filename = Array.isArray(rest) ? rest.join('/') : rest;
    if (!filename || typeof filename !== 'string') {
      throw new BadRequestException('Invalid file path');
    }

    try {
      const fullPath = this.service.safeJoinCategory(rootId, category, [
        filename,
      ]);
      const mimeType = getMimeType(filename);

      if (mimeType.startsWith('image/') && (w || h || q || format)) {
        await this.serveProcessedImage(fullPath, w, h, q, format, res);
        return;
      }

      await serveStaticFile(fullPath, filename, req, res, {
        download: isDownload,
      });
    } catch (e) {
      // 路径穿越等非法请求返回 400，其余（不存在/读取失败）返回 404
      if (e instanceof Error && e.message === 'Invalid path') {
        throw new BadRequestException('Invalid file path');
      }
      throw new NotFoundException('File not found');
    }
  }

  private async serveProcessedImage(
    fullPath: string,
    w: string | undefined,
    h: string | undefined,
    q: string | undefined,
    format: string | undefined,
    res: Response,
  ) {
    const width = w ? parseInt(w, 10) : undefined;
    const height = h ? parseInt(h, 10) : undefined;
    const quality = q ? Math.min(100, Math.max(1, parseInt(q, 10))) : 80;
    const outputFormat = format || 'webp';

    const { buffer, mimeType } = await this.imageProcessor.processImage(
      fullPath,
      width,
      height,
      quality,
      outputFormat,
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  }

  @Patch(':rootId/:category/*path')
  @ApiOperation({ summary: '重命名文件' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiParam({ name: 'category', description: '分类目录名' })
  @ApiParam({ name: 'path', description: '文件相对路径' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['newName'],
      properties: {
        newName: { type: 'string', description: '新文件名（不含路径分隔符）' },
      },
    },
  })
  async renameFile(
    @Param('rootId') rootId: string,
    @Param('category') category: string,
    @Param('path') path: string[] | string,
    @Body() dto: RenameFileDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const filename = Array.isArray(path) ? path.join('/') : path;
    if (!filename) {
      throw new BadRequestException('Invalid file path');
    }
    const result = await this.service.renameFile(
      rootId,
      category,
      filename,
      dto.newName,
    );
    // 审计：重命名文件
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'file.rename',
      resourceType: 'file',
      details: { rootId, category, path: filename, newName: dto.newName },
      ...getRequestMeta(req),
    });
    return result;
  }

  @Delete(':rootId/:category/*path')
  @ApiOperation({ summary: '删除文件' })
  @ApiParam({ name: 'rootId', description: '根目录 ID' })
  @ApiParam({ name: 'category', description: '分类目录名' })
  @ApiParam({ name: 'path', description: '文件相对路径' })
  async deleteFile(
    @Param('rootId') rootId: string,
    @Param('category') category: string,
    @Param('path') path: string[] | string,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const filename = Array.isArray(path) ? path.join('/') : path;
    try {
      await this.service.deleteFile(rootId, category, filename);
      // 审计：删除文件
      this.auditLogService.log({
        userId: currentUser.userId,
        username: currentUser.username,
        action: 'file.delete',
        resourceType: 'file',
        details: { rootId, category, path: filename },
        ...getRequestMeta(req),
      });
      return { success: true };
    } catch {
      throw new NotFoundException('File not found');
    }
  }
}
