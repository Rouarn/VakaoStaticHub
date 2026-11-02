import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  access,
  constants,
  mkdir,
  readdir,
  readFile,
  rename as fsRename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { platform } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import {
  safeJoin,
  normalizeCategoryPath,
  getFileExtension,
  UPLOAD_ID_REGEX,
} from './utils/path-utils.js';
import { SOFTWARE_UPDATE_ROOT_ID } from '../app-update/app-update.constants.js';
import type {
  UsageStatsResult,
  BatchDeleteResult,
  BatchMoveResult,
  DuplicateScanResult,
  ChunkUploadInitResult,
} from '@vakao/shared';

@Injectable()
export class FilesService {
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

  async listSystemDirectories(path?: string) {
    if (!path) {
      if (platform() === 'win32') {
        const drives = [];
        for (let i = 65; i <= 90; i++) {
          const letter = String.fromCharCode(i);
          const driveRoot = `${letter}:\\`;
          try {
            await access(driveRoot, constants.F_OK);
            drives.push({ name: `${letter}:`, path: driveRoot });
          } catch {
            // ignore inaccessible drives
          }
        }
        return drives;
      } else {
        path = '/';
      }
    }

    const target = isAbsolute(path) ? path : resolve(process.cwd(), path);
    const entries = await readdir(target, { withFileTypes: true });
    return entries
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, path: join(target, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
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

  /**
   * 存储用量统计：按资源根/分类聚合 file_entries 索引表
   * 数据与文件索引实时一致（索引本身由文件操作事件驱动同步）
   */
  async getUsageStats(): Promise<UsageStatsResult> {
    const rows = await this.repo
      .createQueryBuilder('f')
      .select('f.rootId', 'rootId')
      .addSelect('f.category', 'category')
      .addSelect('SUM(f.size)', 'totalSize')
      .addSelect('COUNT(*)', 'fileCount')
      .groupBy('f.rootId')
      .addGroupBy('f.category')
      .getRawMany<{
        rootId: string;
        category: string;
        totalSize: number | string;
        fileCount: number | string;
      }>();

    const rootMap = new Map<
      string,
      {
        rootId: string;
        rootName: string;
        totalSize: number;
        fileCount: number;
        categories: {
          category: string;
          totalSize: number;
          fileCount: number;
        }[];
      }
    >();

    for (const row of rows) {
      let root = rootMap.get(row.rootId);
      if (!root) {
        root = {
          rootId: row.rootId,
          rootName: this.resourceRoots.getRoot(row.rootId)?.name ?? row.rootId,
          totalSize: 0,
          fileCount: 0,
          categories: [],
        };
        rootMap.set(row.rootId, root);
      }
      const totalSize = Number(row.totalSize);
      const fileCount = Number(row.fileCount);
      root.categories.push({ category: row.category, totalSize, fileCount });
      root.totalSize += totalSize;
      root.fileCount += fileCount;
    }

    // 补充没有任何索引记录的资源根（空目录也应在统计中可见）
    for (const root of this.resourceRoots.getRoots()) {
      if (!rootMap.has(root.id)) {
        rootMap.set(root.id, {
          rootId: root.id,
          rootName: root.name,
          totalSize: 0,
          fileCount: 0,
          categories: [],
        });
      }
    }

    const roots = [...rootMap.values()].map((root) => ({
      ...root,
      categories: root.categories.sort((a, b) => b.totalSize - a.totalSize),
    }));
    roots.sort((a, b) => b.totalSize - a.totalSize);

    return {
      roots,
      totalSize: roots.reduce((sum, r) => sum + r.totalSize, 0),
      fileCount: roots.reduce((sum, r) => sum + r.fileCount, 0),
    };
  }

  /**
   * 重复文件检测：按内容 SHA-256 分组找出内容完全相同的文件
   * 存量索引记录可能没有 contentHash——先按文件大小分组（大小相同才可能重复），
   * 仅对大小重复且尚未计算哈希的记录惰性补算并回写索引，避免全量扫盘
   */
  async getDuplicateFiles(
    rootId?: string,
    page = 1,
    pageSize = 20,
  ): Promise<DuplicateScanResult> {
    // 1. 找出存在重复的文件大小（忽略 0 字节文件，空文件无去重意义）
    const sizeQb = this.repo
      .createQueryBuilder('f')
      .select('f.size', 'size')
      .where('f.size > 0')
      .groupBy('f.size')
      .having('COUNT(*) > 1');
    if (rootId) {
      sizeQb.andWhere('f.rootId = :rootId', { rootId });
    }
    const dupSizes = await sizeQb.getRawMany<{ size: number | string }>();
    const sizes = dupSizes.map((r) => Number(r.size));

    // 2. 对大小重复但缺少哈希的记录补算 SHA-256 并回写索引
    let hashedCount = 0;
    if (sizes.length > 0) {
      const pendingQb = this.repo
        .createQueryBuilder('f')
        .where('f.contentHash IS NULL')
        .andWhere('f.size IN (:...sizes)', { sizes });
      if (rootId) {
        pendingQb.andWhere('f.rootId = :rootId', { rootId });
      }
      const pending = await pendingQb.getMany();

      for (const row of pending) {
        try {
          const absPath = safeJoin(
            this.resourceRoots.resolveRootPath(row.rootId),
            [row.category, row.relPath],
          );
          const s = await stat(absPath);
          // 文件在索引后被修改过：大小或修改时间不一致时哈希无意义，跳过
          if (s.size !== row.size || s.mtimeMs !== row.mtimeMs) continue;
          const hash = createHash('sha256');
          await pipeline(createReadStream(absPath), hash);
          row.contentHash = hash.digest('hex');
          await this.repo.update(
            { id: row.id },
            { contentHash: row.contentHash },
          );
          hashedCount++;
        } catch {
          // 文件已被移动/删除等，跳过等待下次索引同步
        }
      }
    }

    // 3. 按内容哈希分组，保留数量大于 1 的重复组
    const hashQb = this.repo
      .createQueryBuilder('f')
      .select('f.contentHash', 'contentHash')
      .where('f.contentHash IS NOT NULL')
      .groupBy('f.contentHash')
      .having('COUNT(*) > 1');
    if (rootId) {
      hashQb.andWhere('f.rootId = :rootId', { rootId });
    }
    const dupHashes = await hashQb.getRawMany<{ contentHash: string }>();

    const groups = [];
    for (const { contentHash } of dupHashes) {
      const files = await this.repo.find({
        where: rootId ? { contentHash, rootId } : { contentHash },
        order: { mtimeMs: 'DESC' },
      });
      groups.push({
        contentHash,
        size: files[0]?.size ?? 0,
        count: files.length,
        files: files.map((f) => ({
          rootId: f.rootId,
          category: f.category,
          relPath: f.relPath,
          name: f.name,
          size: f.size,
          mtime: f.mtimeMs,
        })),
      });
    }
    groups.sort((a, b) => b.size * b.count - a.size * a.count);

    const groupCount = groups.length;
    const start = (page - 1) * pageSize;

    return {
      groups: groups.slice(start, start + pageSize),
      groupCount,
      duplicateFileCount: groups.reduce((sum, g) => sum + g.count, 0),
      hashedCount,
      page,
      pageSize,
    };
  }

  async listFilesPaged(
    rootId: string,
    category: string,
    opts: {
      page: number;
      pageSize: number;
      q?: string;
      sort?: string;
      order?: 'asc' | 'desc';
    },
  ) {
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
      items: rows.map((r) => {
        let relativePath = r.relPath;
        if (relPathSuffix && relativePath.startsWith(relPathSuffix + '/')) {
          relativePath = relativePath.substring(relPathSuffix.length + 1);
        }
        return {
          name: r.name,
          path: relativePath,
          size: r.size,
          mtime: r.mtimeMs,
        };
      }),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }

  async saveFile(
    rootId: string,
    category: string,
    filename: string,
    buffer: Buffer,
  ) {
    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    const relPath = relPathSuffix ? `${relPathSuffix}/${filename}` : filename;

    const targetPath = safeJoin(this.resourceRoots.resolveRootPath(rootId), [
      dbCategory,
      relPath,
    ]);

    await mkdir(resolve(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, buffer);
    const s = await stat(targetPath);

    // 上传内容已在内存中，直接计算 SHA-256 用于重复文件检测
    const contentHash = createHash('sha256').update(buffer).digest('hex');

    await this.repo.upsert(
      {
        rootId,
        category: dbCategory,
        relPath,
        name: filename,
        ext: getFileExtension(filename),
        size: s.size,
        mtimeMs: s.mtimeMs,
        contentHash,
      },
      ['rootId', 'category', 'relPath'],
    );

    return {
      name: filename,
      path: filename,
      size: s.size,
      mtime: s.mtimeMs,
    };
  }

  async batchSaveFiles(
    rootId: string,
    category: string,
    files: Array<{ originalname: string; buffer: Buffer }>,
  ) {
    const results = [];
    for (const file of files) {
      try {
        const originalName = Buffer.from(file.originalname, 'latin1').toString(
          'utf8',
        );
        await this.saveFile(rootId, category, originalName, file.buffer);
        results.push({ name: originalName, success: true });
      } catch (e) {
        results.push({
          name: file.originalname,
          success: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return results;
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

        await mkdir(resolve(targetPath, '..'), { recursive: true });
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
      console.warn('清理空目录失败:', e);
    }
  }

  // ==================== 大文件分片上传 ====================

  /** 分片临时目录：操作系统临时目录下的应用专属子目录
   *  配置收敛到 files.uploadTempDir（默认 os.tmpdir()/vakao-static-hub/uploads，
   *  可通过 UPLOAD_TEMP_DIR 环境变量覆盖） */
  private get chunkUploadDir(): string {
    const dir = this.configService.get<string>('files.uploadTempDir');
    if (!dir) {
      throw new Error('files.uploadTempDir 未配置');
    }
    return dir;
  }

  private sanitizeUploadId(id: string): string {
    if (!UPLOAD_ID_REGEX.test(id)) {
      throw new BadRequestException('uploadId 不合法');
    }
    return id;
  }

  /** 已取消的 uploadId 集合：阻止取消瞬间仍在途的分片写入重建临时目录 */
  private readonly cancelledUploads = new Set<string>();

  private getChunkUploadPath(uploadId: string): string {
    return resolve(this.chunkUploadDir, this.sanitizeUploadId(uploadId));
  }

  /**
   * 初始化分片上传
   * 返回 uploadId；若 uploadId 已存在则返回已上传分片列表（断点续传）
   */
  async initChunkUpload(
    rootId: string,
    category: string,
    filename: string,
    size: number,
    chunkSize: number,
    userId: number,
  ): Promise<ChunkUploadInitResult> {
    // uploadId 必须用稳定标识（不含时间戳），否则相同文件重复 init 会得到不同 id，
    // 导致断点续传失效——前端无法拿到已上传分片列表
    // 同时必须带上 userId：两个用户同时上传同名同大小文件如果命中同一个 uploadId
    // 会互相覆盖分片目录（saveChunk 会互相覆写同一个 index 文件），
    // 加 userId 把同一 uploadId 限制在单个用户的会话空间内。
    const uploadId = createHash('md5')
      .update(`${userId}:${rootId}:${category}:${filename}:${size}`)
      .digest('hex');

    // 新的上传尝试开始：清除上一次「已取消」标记，
    // 否则相同文件取消后重新上传会被 saveChunk 误判为已取消。
    this.cancelledUploads.delete(uploadId);

    const uploadDir = this.getChunkUploadPath(uploadId);
    await mkdir(uploadDir, { recursive: true });

    // 检查是否有已上传的分片（断点续传场景：相同文件第二次 init 时复用已有 uploadId）
    let uploadedChunks: number[] = [];
    try {
      const files = await readdir(uploadDir);
      uploadedChunks = files
        .filter((f) => /^\d+$/.test(f))
        .map((f) => parseInt(f, 10))
        .sort((a, b) => a - b);
    } catch {
      // 目录刚创建，无分片
    }

    return { uploadId, chunkSize, uploadedChunks };
  }

  /**
   * 保存单个分片
   */
  async saveChunk(uploadId: string, index: number, buffer: Buffer) {
    if (this.cancelledUploads.has(uploadId)) {
      throw new BadRequestException('上传已取消');
    }
    const uploadDir = this.getChunkUploadPath(uploadId);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(resolve(uploadDir, String(index)), buffer);
    // 取消与在途分片写入存在竞态：cancel 的 rm 可能先执行，
    // 分片随后又重建了临时目录。写完后再检查一次并主动清理，
    // 保证「取消后临时目录一定不存在」。
    if (this.cancelledUploads.has(uploadId)) {
      await rm(uploadDir, { recursive: true, force: true });
      throw new BadRequestException('上传已取消');
    }
    return { index, size: buffer.length };
  }

  /**
   * 取消分片上传，清理临时目录
   */
  async cancelChunkUpload(uploadId: string) {
    const safeId = this.sanitizeUploadId(uploadId);
    this.cancelledUploads.add(safeId);
    // 标记只需覆盖「取消瞬间仍在途的分片请求」，5 分钟后自动释放，避免集合无限增长
    const timer = setTimeout(
      () => this.cancelledUploads.delete(safeId),
      5 * 60 * 1000,
    );
    timer.unref?.();
    const uploadDir = this.getChunkUploadPath(uploadId);
    await rm(uploadDir, { recursive: true, force: true });
    return { success: true };
  }

  /**
   * 合并分片，写入目标位置并建立索引
   */
  async completeChunkUpload(
    uploadId: string,
    rootId: string,
    category: string,
    filename: string,
    expectedSize: number,
  ) {
    const uploadDir = this.getChunkUploadPath(uploadId);

    if (this.cancelledUploads.has(uploadId)) {
      await rm(uploadDir, { recursive: true, force: true });
      throw new BadRequestException('上传已取消');
    }

    // 读取所有分片索引
    const files = await readdir(uploadDir);
    const chunkIndices = files
      .filter((f) => /^\d+$/.test(f))
      .map((f) => parseInt(f, 10))
      .sort((a, b) => a - b);

    if (chunkIndices.length === 0) {
      throw new BadRequestException('没有可合并的分片');
    }

    // 按顺序读取并合并
    const chunks: Buffer[] = [];
    let totalSize = 0;
    for (const idx of chunkIndices) {
      const chunkPath = resolve(uploadDir, String(idx));
      const chunk = await readFile(chunkPath);
      chunks.push(chunk);
      totalSize += chunk.length;
    }

    if (totalSize !== expectedSize) {
      throw new BadRequestException(
        `文件大小不匹配，期望 ${expectedSize} 字节，实际 ${totalSize} 字节`,
      );
    }

    const merged = Buffer.concat(chunks);
    const contentHash = createHash('sha256').update(merged).digest('hex');

    const { dbCategory, relPathSuffix } = normalizeCategoryPath(category);
    const relPath = relPathSuffix ? `${relPathSuffix}/${filename}` : filename;

    const targetPath = safeJoin(this.resourceRoots.resolveRootPath(rootId), [
      dbCategory,
      relPath,
    ]);

    await mkdir(resolve(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, merged);
    const s = await stat(targetPath);

    await this.repo.upsert(
      {
        rootId,
        category: dbCategory,
        relPath,
        name: filename,
        ext: getFileExtension(filename),
        size: s.size,
        mtimeMs: s.mtimeMs,
        contentHash,
      },
      ['rootId', 'category', 'relPath'],
    );

    // 清理临时分片
    await rm(uploadDir, { recursive: true, force: true });

    return {
      name: filename,
      path: filename,
      size: s.size,
      mtime: s.mtimeMs,
      contentHash,
    };
  }

  /**
   * 校验文件名是否为合法的 basename
   * 禁止路径分隔符、控制字符、"." / ".." 以及首尾空白
   */
  private validateBasename(name: string): string {
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
