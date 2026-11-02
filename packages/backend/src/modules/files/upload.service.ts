import { BadRequestException, Injectable } from '@nestjs/common';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import {
  safeJoin,
  normalizeCategoryPath,
  getFileExtension,
  UPLOAD_ID_REGEX,
} from '#/common/utils/path.util.js';
import type {
  ChunkUploadInitResult,
  ChunkUploadCompleteResult,
} from '@vakao/shared';

/**
 * 文件上传服务
 * 负责单/多文件直传与分片上传四步（init / chunk / complete / cancel）
 */
@Injectable()
export class UploadService {
  constructor(
    private readonly resourceRoots: ResourceRootsService,
    private readonly configService: ConfigService,
    @InjectRepository(FileEntryEntity)
    private readonly repo: Repository<FileEntryEntity>,
  ) {}

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

    await mkdir(dirname(targetPath), { recursive: true });
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
  ): Promise<ChunkUploadCompleteResult> {
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

    await mkdir(dirname(targetPath), { recursive: true });
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
}
