import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  access,
  constants,
  mkdir,
  readdir,
  rename as fsRename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import {
  safeJoin,
  normalizeCategoryPath,
  getFileExtension,
} from '#/common/utils/path.util.js';
import { getMimeType } from '#/common/utils/mime.util.js';
import { SOFTWARE_UPDATE_ROOT_ID } from '../app-update/app-update.constants.js';
import { toFileListItem } from './files.mapper.js';
import type { BatchDeleteResult, BatchMoveResult } from '@vakao/shared';

/** 文件列表查询参数 */
export interface ListFilesOptions {
  page: number;
  pageSize: number;
  q?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * 文件域核心服务
 * 负责文件列表、分类增删改、文件重命名/删除/批量删除/批量移动
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly resourceRoots: ResourceRootsService,
    private readonly configService: ConfigService,
    @InjectRepository(FileEntryEntity)
    private readonly repo: Repository<FileEntryEntity>,
    @InjectRepository(ShareLinkEntity)
    private readonly shareRepo: Repository<ShareLinkEntity>,
  ) {}

  /** 默认兜底分类名（DEFAULT_CATEGORY），供前端初始化与校验对齐 */
  getDefaultCategory(): string {
    return (
      this.configService.get<string>('files.defaultCategory') ?? 'TemporaryFile'
    );
  }

  getFileConfig() {
    return { defaultCategory: this.getDefaultCategory() };
  }

  safeJoinCategory(rootId: string, category: string, parts: string[]) {
    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    const { dbCategory } = normalizeCategoryPath(category);
    return safeJoin(rootPath, [dbCategory, ...parts]);
  }

  /** 静态直出目标解析：路径安全校验 + MIME 判定（不触碰 HTTP 上下文） */
  resolveServeTarget(rootId: string, category: string, filename: string) {
    const fullPath = this.safeJoinCategory(rootId, category, [filename]);
    const mimeType = getMimeType(filename);
    return { fullPath, mimeType, isImage: mimeType.startsWith('image/') };
  }

  async listCategories(rootId: string) {
    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    await mkdir(rootPath, { recursive: true });
    const dirs = await readdir(rootPath, { withFileTypes: true });
    return dirs
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * 重命名资源分类（根目录下的一级子目录）
   * 物理目录改名，文件索引与分享链接在同一事务内迁移；
   * software-update 根下的分类即应用，需走 APP 版本管理的改名接口
   */
  async renameCategory(rootId: string, category: string, newCategory: string) {
    if (rootId === SOFTWARE_UPDATE_ROOT_ID) {
      throw new BadRequestException(
        'software-update 根下的分类即应用，请在 APP 版本管理中修改应用标识',
      );
    }

    const root = this.resourceRoots.getRoot(rootId);
    if (!root) {
      throw new NotFoundException('资源根目录不存在');
    }

    const defaultCategory = this.getDefaultCategory();

    const targetName = this.validateBasename(newCategory);
    const { dbCategory } = normalizeCategoryPath(category);
    if (!dbCategory) {
      throw new BadRequestException('分类名不合法');
    }

    if (dbCategory === defaultCategory) {
      throw new BadRequestException('默认分类不可重命名');
    }
    if (targetName === defaultCategory) {
      throw new BadRequestException('默认分类名为系统保留，不可使用');
    }

    if (dbCategory === targetName) {
      throw new BadRequestException('新分类名与当前分类名相同');
    }

    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    const oldFullPath = safeJoin(rootPath, [dbCategory]);
    const newFullPath = safeJoin(rootPath, [targetName]);

    let sourceStat;
    try {
      sourceStat = await stat(oldFullPath);
    } catch {
      throw new NotFoundException('分类不存在');
    }
    if (!sourceStat.isDirectory()) {
      throw new BadRequestException('目标不是分类目录');
    }

    try {
      await access(newFullPath, constants.F_OK);
      throw new ConflictException('同名分类已存在');
    } catch (e) {
      if (e instanceof ConflictException) throw e;
    }

    // 先在事务内迁移文件索引与分享链接，再执行物理目录改名
    await this.repo.manager.transaction(async (manager) => {
      await manager.update(
        FileEntryEntity,
        { rootId, category: dbCategory },
        { category: targetName },
      );
      await manager.update(
        ShareLinkEntity,
        { rootId, category: dbCategory },
        { category: targetName },
      );
    });

    await fsRename(oldFullPath, newFullPath);

    return { category: targetName };
  }

  /**
   * 新建空分类（根目录下的一级子目录）
   * software-update 根下的分类即应用，必须走 APP 版本管理的应用创建接口
   */
  async createCategory(rootId: string, name: string) {
    if (rootId === SOFTWARE_UPDATE_ROOT_ID) {
      throw new BadRequestException(
        'software-update 根下的分类即应用，请在 APP 版本管理中创建应用',
      );
    }
    const root = this.resourceRoots.getRoot(rootId);
    if (!root) {
      throw new NotFoundException('资源根目录不存在');
    }

    const category = this.validateBasename(name);
    if (category.startsWith('.')) {
      throw new BadRequestException('分类名不能以 . 开头');
    }
    if (category === this.getDefaultCategory()) {
      throw new BadRequestException('默认分类名为系统保留，不可使用');
    }

    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    await mkdir(rootPath, { recursive: true });
    const fullPath = safeJoin(rootPath, [category]);

    try {
      await access(fullPath, constants.F_OK);
      throw new ConflictException('同名分类已存在');
    } catch (e) {
      if (e instanceof ConflictException) throw e;
    }

    try {
      await mkdir(fullPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ConflictException('同名分类已存在');
      }
      throw e;
    }

    return { category };
  }

  /**
   * 删除分类（根目录下的一级子目录）
   * - 默认只允许删除空分类；recursive=true 时连同文件索引/分享链接/磁盘文件一起删除
   * - 拒绝默认分类与受保护根目录（software-update）
   */
  async deleteCategory(rootId: string, category: string, recursive = false) {
    if (rootId === SOFTWARE_UPDATE_ROOT_ID) {
      throw new BadRequestException(
        'software-update 为受保护根目录，请通过 APP 版本管理删除应用',
      );
    }
    const root = this.resourceRoots.getRoot(rootId);
    if (!root) {
      throw new NotFoundException('资源根目录不存在');
    }

    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    if (!dbCategory) {
      throw new BadRequestException('分类名不合法');
    }
    if (relPathSuffix) {
      throw new BadRequestException('仅支持删除一级分类目录');
    }
    if (dbCategory === this.getDefaultCategory()) {
      throw new BadRequestException('默认分类不可删除');
    }

    const fullPath = safeJoin(this.resourceRoots.resolveRootPath(rootId), [
      dbCategory,
    ]);

    let sourceStat;
    try {
      sourceStat = await stat(fullPath);
    } catch {
      throw new NotFoundException('分类不存在');
    }
    if (!sourceStat.isDirectory()) {
      throw new BadRequestException('目标不是分类目录');
    }

    const entries = await readdir(fullPath);
    if (entries.length > 0 && !recursive) {
      throw new ConflictException(
        `分类非空（${entries.length} 项）；如需连同文件一并删除，请显式传 recursive=true`,
      );
    }

    await this.repo.manager.transaction(async (manager) => {
      await manager.delete(FileEntryEntity, { rootId, category: dbCategory });
      await manager.delete(ShareLinkEntity, { rootId, category: dbCategory });
    });
    await rm(fullPath, { recursive: true, force: true });

    return { success: true, removedEntries: entries.length };
  }

  async listFilesPaged(
    rootId: string,
    category: string,
    opts: ListFilesOptions,
  ) {
    // 根目录不存在时统一 404（与分类、上传等接口保持一致），避免返回空列表掩盖错误
    this.resourceRoots.resolveRootPath(rootId);

    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);

    const qb = this.repo
      .createQueryBuilder('f')
      .where('f.rootId = :rootId', { rootId })
      .andWhere('f.category = :category', { category: dbCategory });

    if (relPathSuffix) {
      qb.andWhere('f.relPath LIKE :prefix', { prefix: `${relPathSuffix}/%` });
    }

    if (opts.q && opts.q.trim()) {
      qb.andWhere('(f.name LIKE :q OR f.relPath LIKE :q)', {
        q: `%${opts.q.trim()}%`,
      });
    }

    const sortField = opts.sort || 'mtime';
    const sortOrder = (opts.order || 'desc').toUpperCase() as 'ASC' | 'DESC';

    if (sortField === 'mtime') {
      qb.orderBy('f.mtimeMs', sortOrder);
    } else if (sortField === 'name') {
      qb.orderBy('f.name', sortOrder);
    } else if (sortField === 'size') {
      qb.orderBy('f.size', sortOrder);
    } else {
      qb.orderBy('f.mtimeMs', 'DESC');
    }

    const skip = (opts.page - 1) * opts.pageSize;
    qb.skip(skip).take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();

    return {
      items: rows.map((row) => toFileListItem(row, relPathSuffix)),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }

  async batchDeleteFiles(
    rootId: string,
    category: string,
    paths: string[],
  ): Promise<BatchDeleteResult> {
    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    const rootPath = this.resourceRoots.resolveRootPath(rootId);

    await this.repo.manager.transaction(async (manager) => {
      for (const filename of paths) {
        const relPath = relPathSuffix
          ? `${relPathSuffix}/${filename}`
          : filename;
        const targetPath = safeJoin(rootPath, [dbCategory, relPath]);

        await rm(targetPath, { force: true });
        await manager.delete(FileEntryEntity, {
          rootId,
          category: dbCategory,
          relPath,
        });

        try {
          let currentDir = dirname(targetPath);
          const categoryRoot = safeJoin(rootPath, [dbCategory]);
          while (true) {
            if (
              !currentDir.startsWith(categoryRoot) ||
              currentDir === categoryRoot
            ) {
              break;
            }
            const files = await readdir(currentDir);
            if (files.length === 0) {
              await rm(currentDir, { force: true });
              currentDir = dirname(currentDir);
            } else {
              break;
            }
          }
        } catch {
          // 忽略空目录清理失败
        }
      }
    });

    return { deletedCount: paths.length };
  }

  /**
   * 批量移动文件到另一个分类
   * 物理文件移动 + 文件索引迁移 + 分享链接同步更新（单事务）
   */
  async batchMoveFiles(
    rootId: string,
    category: string,
    paths: string[],
    targetCategory: string,
  ): Promise<BatchMoveResult> {
    if (rootId === SOFTWARE_UPDATE_ROOT_ID) {
      throw new BadRequestException(
        'software-update 根下的分类即应用，移动文件会破坏版本记录，请在 APP 版本管理中操作',
      );
    }

    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    const { dbCategory: targetDbCategory } =
      normalizeCategoryPath(targetCategory);

    if (dbCategory === targetDbCategory) {
      throw new BadRequestException('目标分类与当前分类相同');
    }

    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    const sourceRoot = safeJoin(rootPath, [dbCategory]);
    const targetRoot = safeJoin(rootPath, [targetDbCategory]);

    try {
      await access(targetRoot, constants.F_OK);
    } catch {
      throw new NotFoundException('目标分类不存在');
    }

    const results: { path: string; success: boolean; error?: string }[] = [];

    await this.repo.manager.transaction(async (manager) => {
      for (const filename of paths) {
        const relPath = relPathSuffix
          ? `${relPathSuffix}/${filename}`
          : filename;
        const sourcePath = safeJoin(rootPath, [dbCategory, relPath]);
        const targetPath = safeJoin(rootPath, [targetDbCategory, relPath]);

        try {
          await access(sourcePath, constants.F_OK);
        } catch {
          results.push({ path: filename, success: false, error: '文件不存在' });
          continue;
        }

        try {
          await access(targetPath, constants.F_OK);
          results.push({
            path: filename,
            success: false,
            error: '目标位置已存在同名文件',
          });
          continue;
        } catch {
          // 目标不存在，可继续
        }

        await mkdir(dirname(targetPath), { recursive: true });
        await fsRename(sourcePath, targetPath);

        await manager.update(
          FileEntryEntity,
          { rootId, category: dbCategory, relPath },
          { category: targetDbCategory },
        );

        // 分享链接以 filePaths（分类内相对路径数组）表达，命中该路径的链接随分类一起迁移
        const affectedShares = await manager.find(ShareLinkEntity, {
          where: { rootId, category: dbCategory },
        });
        for (const link of affectedShares) {
          const linkPaths = JSON.parse(link.filePaths) as string[];
          if (!linkPaths.includes(relPath)) continue;
          await manager.update(ShareLinkEntity, link.id, {
            category: targetDbCategory,
          });
        }

        results.push({ path: filename, success: true });

        try {
          let currentDir = dirname(sourcePath);
          while (true) {
            if (
              !currentDir.startsWith(sourceRoot) ||
              currentDir === sourceRoot
            ) {
              break;
            }
            const files = await readdir(currentDir);
            if (files.length === 0) {
              await rm(currentDir, { force: true });
              currentDir = dirname(currentDir);
            } else {
              break;
            }
          }
        } catch {
          // 忽略空目录清理失败
        }
      }
    });

    return { results, movedCount: results.filter((r) => r.success).length };
  }

  async deleteFile(rootId: string, category: string, filename: string) {
    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    const relPath = relPathSuffix ? `${relPathSuffix}/${filename}` : filename;

    const targetPath = safeJoin(this.resourceRoots.resolveRootPath(rootId), [
      dbCategory,
      relPath,
    ]);

    await rm(targetPath, { force: true });
    await this.repo.delete({ rootId, category: dbCategory, relPath });

    try {
      let currentDir = dirname(targetPath);
      const categoryRoot = safeJoin(
        this.resourceRoots.resolveRootPath(rootId),
        [dbCategory],
      );

      while (true) {
        if (
          !currentDir.startsWith(categoryRoot) ||
          currentDir === categoryRoot
        ) {
          break;
        }

        const files = await readdir(currentDir);
        if (files.length === 0) {
          await rm(currentDir, { force: true });
          currentDir = dirname(currentDir);
        } else {
          break;
        }
      }
    } catch (e) {
      this.logger.warn(`清理空目录失败: ${(e as Error).message}`);
    }
  }

  /**
   * 校验文件名是否为合法的 basename
   * 禁止路径分隔符、控制字符、"." / ".." 以及首尾空白
   */
  validateBasename(name: string): string {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    const hasControlChar =
      trimmed.length > 0 &&
      Array.from(trimmed).some((ch) => ch.charCodeAt(0) <= 31);
    if (
      !trimmed ||
      trimmed === '.' ||
      trimmed === '..' ||
      trimmed.includes('\\') ||
      trimmed.includes('/') ||
      hasControlChar
    ) {
      throw new BadRequestException('文件名不合法');
    }
    return trimmed;
  }

  /**
   * 重命名文件（仅允许修改 basename，不改变所在目录）
   * 严格模式：源文件不存在直接报错；目标路径已存在返回冲突
   * 物理文件、文件索引与分享链接路径在同一操作内同步更新
   */
  async renameFile(
    rootId: string,
    category: string,
    filename: string,
    newName: string,
  ) {
    const targetName = this.validateBasename(newName);

    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    const oldRelPath = relPathSuffix
      ? `${relPathSuffix}/${filename}`
      : filename;

    // 仅替换 basename，保留原有目录段
    const dirPart = dirname(oldRelPath);
    const newRelPath =
      dirPart === '.' ? targetName : `${dirPart}/${targetName}`;

    if (oldRelPath === newRelPath) {
      throw new BadRequestException('新文件名与原文件名相同');
    }

    const rootPath = this.resourceRoots.resolveRootPath(rootId);
    const oldFullPath = safeJoin(rootPath, [dbCategory, oldRelPath]);
    const newFullPath = safeJoin(rootPath, [dbCategory, newRelPath]);

    // 源文件必须真实存在，避免产生磁盘与索引不一致的记录
    let sourceStat;
    try {
      sourceStat = await stat(oldFullPath);
    } catch {
      throw new NotFoundException('文件不存在');
    }
    if (!sourceStat.isFile()) {
      throw new BadRequestException('目标不是文件');
    }

    // 目标路径已存在（磁盘或索引任一命中即视为冲突）
    try {
      await access(newFullPath, constants.F_OK);
      throw new ConflictException('同名文件已存在');
    } catch (e) {
      if (e instanceof ConflictException) throw e;
    }

    const indexConflict = await this.repo.findOne({
      where: { rootId, category: dbCategory, relPath: newRelPath },
    });
    if (indexConflict) {
      throw new ConflictException('同名文件已存在');
    }

    await fsRename(oldFullPath, newFullPath);

    const s = await stat(newFullPath);
    await this.repo.update(
      { rootId, category: dbCategory, relPath: oldRelPath },
      {
        relPath: newRelPath,
        name: targetName,
        ext: getFileExtension(targetName),
        size: s.size,
        mtimeMs: s.mtimeMs,
      },
    );

    // 同步更新分享链接中指向该文件的路径（filePaths 为分类内相对路径数组）
    const fileDir = dirname(filename);
    const newFilePath =
      fileDir === '.' ? targetName : `${fileDir}/${targetName}`;
    if (filename !== newFilePath) {
      const affectedShares = await this.shareRepo.find({
        where: { rootId, category },
      });
      for (const link of affectedShares) {
        const replaced = this.rewriteSharePaths(
          link.filePaths,
          filename,
          newFilePath,
        );
        if (replaced) {
          await this.shareRepo.update(link.id, { filePaths: replaced });
        }
      }
    }

    return {
      name: targetName,
      path: newFilePath,
      size: s.size,
      mtime: s.mtimeMs,
    };
  }

  /** 在分享链接的 filePaths JSON 数组里替换命中路径；未命中返回 null */
  private rewriteSharePaths(
    raw: string,
    match: string,
    replacement: string,
  ): string | null {
    const paths = JSON.parse(raw) as string[];
    if (!paths.includes(match)) return null;
    const next = [
      ...new Set(paths.map((p) => (p === match ? replacement : p))),
    ];
    return JSON.stringify(next);
  }
}
