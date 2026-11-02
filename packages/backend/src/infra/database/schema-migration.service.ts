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
 *   - 全新空库：首次部署时 synchronize 已按实体建好表，迁移会跳过
 *   - 数据保留：ALTER TABLE ADD COLUMN 不会动已有行的任何数据
 *
 * 当前已知迁移项（每次新增需要 ALTER 的字段时追加到 MIGRATIONS 数组）：
 *   - 2026-11-02: app_versions 表新增 offlineReason 列
 *     语义：区分"被新全量 publish 自动挤掉"（auto，可 rollback 恢复）vs
 *            "管理员手动止血下架"（manual，不可 rollback 恢复）vs null（从未全量发布）
 *   - 2026-11-02: share_links 表新增 remark / enabled 列
 *     语义：后台备注（不外显）与启停开关（停用后公开访问返回“已停用”）
 *   - 2026-11-02: users 表新增 role 列
 *     语义：admin / user；老库升级后若没有任何 admin，会把最早创建的账号提升为 admin
 *   - 2026-11-03: share_links 收敛为 filePaths 单一形态
 *     语义：filePaths 存 1..N 个相对路径的 JSON 数组，分享类型由长度派生；
 *           物理删除废弃列 filePath / shareType（重建表，数据从旧列迁移）
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
  {
    table: 'share_links',
    column: 'remark',
    alterSql: 'ALTER TABLE share_links ADD COLUMN remark varchar(255)',
    description: '分享链接后台备注',
  },
  {
    table: 'share_links',
    column: 'enabled',
    alterSql:
      'ALTER TABLE share_links ADD COLUMN enabled integer NOT NULL DEFAULT 1',
    description: '分享链接启停开关（1 启用 / 0 停用）',
  },
  {
    table: 'users',
    column: 'role',
    alterSql:
      "ALTER TABLE users ADD COLUMN role varchar(16) NOT NULL DEFAULT 'user'",
    description: '用户角色（admin / user）',
  },
  {
    table: 'share_links',
    column: 'filePaths',
    alterSql: 'ALTER TABLE share_links ADD COLUMN filePaths text',
    description:
      '分享文件相对路径的 JSON 数组（存量库补齐后由重建流程收紧为 NOT NULL）',
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

    // 数据迁移：share_links 收敛为 filePaths 单一形态（重建表，物理删除废弃列）
    await this.migrateShareLinksToFilePaths();

    // 数据迁移：老库升级后若没有任何管理员，把最早创建的账号提升为 admin，
    // 保证「至少保留一个管理员」的后端校验有可用的初始管理员。
    await this.ensureAtLeastOneAdmin();
  }

  /**
   * 把存量 share_links 升级为唯一形态：只有 filePaths（1..N 的 JSON 数组，NOT NULL）。
   *
   * 旧形态是「filePath 必填 + 可选 shareType/filePaths」，属于已废弃的兼容层。
   * 迁移步骤：
   *   1. 读取旧行，优先沿用已有 filePaths；否则用 filePath 包成长度 1 的数组
   *   2. 重建表（与实体完全一致），物理删除 filePath / shareType
   * 新库由 synchronize 直接按最终实体建表，本方法会直接跳过。
   */
  private async migrateShareLinksToFilePaths(): Promise<void> {
    const hasFilePath = await this.columnExists('share_links', 'filePath');
    const hasShareType = await this.columnExists('share_links', 'shareType');
    if (!hasFilePath && !hasShareType) {
      return;
    }

    // 理论上 shareType 必然与 filePath 同时出现；若只残留 shareType，直接物理删除
    if (!hasFilePath) {
      await this.dataSource.query(
        'ALTER TABLE share_links DROP COLUMN shareType',
      );
      this.logger.log('share_links 已移除废弃列 shareType');
      return;
    }

    const rows: {
      id: number;
      filePath: string | null;
      filePaths: string | null;
    }[] = await this.dataSource.query(
      'SELECT id, filePath, filePaths FROM share_links',
    );

    for (const row of rows) {
      const existing = this.readStoredPaths(row.filePaths);
      const paths = existing ?? (row.filePath ? [row.filePath] : []);
      if (paths.length === 0) {
        throw new Error(`share_links.id=${row.id} 没有任何可迁移的文件路径`);
      }
      await this.dataSource.query(
        'UPDATE share_links SET filePaths = ? WHERE id = ?',
        [JSON.stringify(paths), row.id],
      );
    }

    // 重建表：列顺序与实体一致，filePaths 收紧为 NOT NULL
    await this.dataSource.query(`
      CREATE TABLE "share_links_rebuild" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "token" varchar(64) NOT NULL,
        "rootId" varchar(64) NOT NULL,
        "category" varchar(255) NOT NULL,
        "filePaths" text NOT NULL,
        "remark" varchar(255),
        "enabled" integer NOT NULL DEFAULT (1),
        "expiresAt" integer,
        "maxAccesses" integer,
        "passwordHash" varchar(255),
        "accessCount" integer NOT NULL DEFAULT (0),
        "createdAt" integer NOT NULL
      )
    `);
    await this.dataSource.query(`
      INSERT INTO "share_links_rebuild" (
        "id", "token", "rootId", "category", "filePaths", "remark", "enabled",
        "expiresAt", "maxAccesses", "passwordHash", "accessCount", "createdAt"
      )
      SELECT
        "id", "token", "rootId", "category", "filePaths", "remark", "enabled",
        "expiresAt", "maxAccesses", "passwordHash", "accessCount", "createdAt"
      FROM "share_links"
    `);
    await this.dataSource.query('DROP TABLE "share_links"');
    await this.dataSource.query(
      'ALTER TABLE "share_links_rebuild" RENAME TO "share_links"',
    );
    await this.dataSource.query(
      'CREATE UNIQUE INDEX "IDX_9bc1c27d683c427cda047f2320" ON "share_links" ("token")',
    );
    this.logger.log(
      `share_links 已收敛为 filePaths 单一形态（${rows.length} 行），移除 filePath / shareType`,
    );
  }

  /** 读取存量 filePaths：非空 JSON 数组才算有效，其余交给调用方回退到旧 filePath */
  private readStoredPaths(raw: string | null): string[] | null {
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? (parsed as string[])
      : null;
  }

  /** 幂等保证 users 表至少有一个 admin；空表时留给 AuthService 播种管理员 */
  private async ensureAtLeastOneAdmin(): Promise<void> {
    try {
      const rows: { c: string | number }[] = await this.dataSource.query(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'admin'",
      );
      if (Number(rows[0]?.c ?? 0) > 0) {
        return;
      }
      const first: { id: number }[] = await this.dataSource.query(
        'SELECT id FROM users ORDER BY id ASC LIMIT 1',
      );
      if (!first[0]) {
        return;
      }
      await this.dataSource.query(
        "UPDATE users SET role = 'admin' WHERE id = ?",
        [first[0].id],
      );
      this.logger.log(
        `users 表没有管理员，已将最早创建的账号 (id=${first[0].id}) 提升为 admin`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`保证管理员存在的数据迁移失败：${msg}`);
      throw new Error(`users 管理员数据迁移失败: ${msg}`);
    }
  }

  /** 用 PRAGMA table_info 检查指定列是否存在（列名为实体 @Column 的 camelCase 原名） */
  private async columnExists(table: string, column: string): Promise<boolean> {
    const rows: ColumnCheckResult[] = await this.dataSource.query(
      `PRAGMA table_info(${table})`,
    );
    return rows.some((r) => r.name === column);
  }
}
