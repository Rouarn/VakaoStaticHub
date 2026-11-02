/**
 * SchemaMigrationService — 启动期幂等 schema 演进
 *
 * 解决的问题：TypeORM synchronize=false（生产默认）时，老库不会自动获得新列，
 * 任何引用该列的查询都会直接报 "no such column"。
 *
 * 设计原则：
 *   - 零依赖：只用 TypeORM DataSource.query() 执行原生 SQL，不引入任何迁移框架
 *   - 幂等：每次启动都跑一遍，已存在的列跳过，不会重复 ALTER 或覆盖数据
 *   - 安全：迁移失败时 throw Error，阻止服务带着错 schema 跑起来
 *   - 兼容全新空库：首次部署时 synchronize 已经建好表，列天然存在，迁移会跳过
 *   - 数据保留：ALTER TABLE ADD COLUMN 不会动已有行的任何数据，
 *     历史行的 offline_reason 自动为 NULL（SQLite 对 nullable 列的默认行为）
 *
 * 当前已知迁移项（每次新增需要 ALTER 的字段时追加到 MIGRATIONS 数组）：
 *   - 2026-11-02: app_versions 表新增 offline_reason 列
 *     语义：区分"被新全量 publish 自动挤掉"（auto，可 rollback 恢复）vs
 *            "管理员手动止血下架"（manual，不可 rollback 恢复）vs null（从未全量发布）
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface ColumnCheckResult {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface Migration {
  table: string;
  column: string;
  alterSql: string;
  description: string;
}

/** 待执行的 schema 变更清单（按顺序执行）
 *
 * 注意：TypeORM 没有配置全局 snake_case namingStrategy，
 * Entity 属性名即数据库列名（camelCase）。
 * 所以 offlineReason → 列名 offlineReason，contentHash → 列名 contentHash。
 */
const MIGRATIONS: Migration[] = [
  {
    table: 'app_versions',
    column: 'offlineReason',
    alterSql: 'ALTER TABLE app_versions ADD COLUMN offlineReason varchar(8)',
    description: '区分自动下架(auto)与手动下架(manual)，支撑 rollback 候选过滤',
  },
  {
    table: 'file_entries',
    column: 'contentHash',
    alterSql: 'ALTER TABLE file_entries ADD COLUMN contentHash varchar(64)',
    description: '文件内容哈希（SHA-256），支撑增量索引与重复文件检测',
  },
];

@Injectable()
export class SchemaMigrationService implements OnModuleInit {
  private readonly logger = new Logger(SchemaMigrationService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('检查数据库 schema，执行幂等迁移...');
    let migrated = 0;
    let skipped = 0;

    for (const m of MIGRATIONS) {
      try {
        const exists = await this.columnExists(m.table, m.column);
        if (exists) {
          skipped++;
          this.logger.log(`  跳过：${m.table}.${m.column} 已存在`);
          continue;
        }

        this.logger.log(
          `  迁移：为 ${m.table} 添加列 ${m.column} — ${m.description}`,
        );
        await this.dataSource.query(m.alterSql);
        migrated++;
        this.logger.log(`  ✅ ${m.table}.${m.column} 已补齐`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 迁移失败必须阻止服务启动，不能带着错 schema 跑
        this.logger.error(
          `❌ 迁移失败：${m.table}.${m.column} — ${msg}\n` +
            `   请检查数据库文件是否可读可写，或手动执行：\n   ${m.alterSql}`,
        );
        throw new Error(
          `数据库 schema 迁移失败 (${m.table}.${m.column}): ${msg}`,
        );
      }
    }

    this.logger.log(`schema 检查完成：新增 ${migrated} 项，跳过 ${skipped} 项`);
  }

  /** 用 PRAGMA table_info 检查指定列是否存在（SQLite 标准 API） */
  private async columnExists(table: string, column: string): Promise<boolean> {
    const rows: ColumnCheckResult[] = await this.dataSource.query(
      `PRAGMA table_info(${table})`,
    );
    // PRAGMA 返回的列名大小写取决于当初建表时的写法——
    // TypeORM sqljs 驱动 + synchronize 会用 entity 里 @Column 的列名
    // 默认 camelCase，所以 offline_reason（snake_case）。
    // 用大小写无关匹配，兼容不同历史版本
    return rows.some((r) => r.name.toLowerCase() === column.toLowerCase());
  }
}
