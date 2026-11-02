import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import type { UsageStatsResult } from '@vakao/shared';

/**
 * 存储用量统计服务
 * 按资源根/分类聚合 file_entries 索引表
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly resourceRoots: ResourceRootsService,
    @InjectRepository(FileEntryEntity)
    private readonly repo: Repository<FileEntryEntity>,
  ) {}

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
}
