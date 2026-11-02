import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import { safeJoin } from '#/common/utils/path.util.js';
import { toDuplicateGroup } from './files.mapper.js';
import type { DuplicateScanResult } from '@vakao/shared';

/**
 * 重复文件检测服务
 * 按内容 SHA-256 分组；存量记录可惰性补算哈希
 */
@Injectable()
export class DuplicateService {
  constructor(
    private readonly resourceRoots: ResourceRootsService,
    @InjectRepository(FileEntryEntity)
    private readonly repo: Repository<FileEntryEntity>,
  ) {}

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
      groups.push(toDuplicateGroup(contentHash, files));
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
}
