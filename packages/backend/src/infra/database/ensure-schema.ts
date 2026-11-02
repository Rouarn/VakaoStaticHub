import { DataSource } from 'typeorm';
import { UserEntity } from './entities/user.entity.js';
import { hashPassword } from '../../modules/auth/utils/password.util.js';

interface SchemaObject {
  type: string;
  name: string;
  sql: string | null;
}

export interface SyncSchemaResult {
  /** 本次新建的表名 */
  createdTables: string[];
  /** 本次 DDL 发生变化的表/索引名 */
  changedObjects: string[];
  /** 本次 DDL 被删除的表/索引名 */
  droppedObjects: string[];
  /** 同步完成后的全部业务表 */
  tables: string[];
  /** 本次播种的管理员用户名；已存在用户时为 null */
  seededAdmin: string | null;
  /** 同步前对旧分享数据做过的规整动作 */
  legacyFixes: string[];
  /** 结构是否本来就与实体一致 */
  alreadyCurrent: boolean;
}

/**
 * 唯一的 schema 同步 + 播种实现：
 * - 开发启动（DB_SYNCHRONIZE=true）与 `pnpm db:sync` 脚本共用这一份逻辑
 * - schema 以实体定义为唯一来源：`dataSource.synchronize()` 建表/加列/改列/建索引
 * - 同步前先规整旧分享数据，否则旧行里的 NULL 会让 SQLite 重建表时触发 NOT NULL 约束失败
 * - 幂等：结构一致时不产生 DDL；users 非空时跳过播种
 */
export async function syncSchema(
  dataSource: DataSource,
): Promise<SyncSchemaResult> {
  const legacyFixes = await normalizeLegacySharePaths(dataSource);
  const before = await snapshot(dataSource);
  try {
    await dataSource.synchronize();
  } catch (error) {
    throw new Error(
      `数据库结构同步失败：${error instanceof Error ? error.message : String(error)}。` +
        '请检查旧库数据是否满足当前实体约束；可先备份数据库副本后执行 pnpm db:sync 查看差异',
    );
  }
  const after = await snapshot(dataSource);

  const beforeNames = new Set(before.map((o) => o.name));
  const afterNames = new Set(after.map((o) => o.name));
  const createdTables = after
    .filter((o) => o.type === 'table' && !beforeNames.has(o.name))
    .map((o) => o.name);
  const changedObjects = after
    .filter((o) => {
      const old = before.find((b) => b.name === o.name);
      return old !== undefined && (old.sql ?? '') !== (o.sql ?? '');
    })
    .map((o) => o.name);
  const droppedObjects = before
    .filter((o) => !afterNames.has(o.name))
    .map((o) => o.name);

  let seededAdmin: string | null = null;
  const userRepo = dataSource.getRepository(UserEntity);
  const userCount = await userRepo.count();
  if (userCount === 0) {
    const username = process.env.AUTH_USER ?? 'admin';
    const password = process.env.AUTH_PASS ?? 'admin';
    const now = Date.now();
    await userRepo.save(
      userRepo.create({
        username,
        passwordHash: await hashPassword(password),
        role: 'admin',
        createdAt: now,
        updatedAt: now,
      }),
    );
    seededAdmin = username;
  }

  return {
    createdTables,
    changedObjects,
    droppedObjects,
    tables: after.filter((o) => o.type === 'table').map((o) => o.name),
    seededAdmin,
    legacyFixes,
    alreadyCurrent:
      createdTables.length === 0 &&
      changedObjects.length === 0 &&
      droppedObjects.length === 0,
  };
}

/**
 * 规整旧版分享数据，让后续 synchronize 能安全地把 filePaths 收敛为 NOT NULL：
 * - 旧库可能只有单值列 `filePath`（没有 `filePaths`），先补一个可空列再回填
 * - `filePaths` 为 NULL / 空串的行，用旧列 `filePath` 包成 JSON 数组；两者都没有时置为 `[]`
 * 这里只处理数据，不负责建表/加索引等结构变更，结构仍完全交给 synchronize。
 */
async function normalizeLegacySharePaths(
  dataSource: DataSource,
): Promise<string[]> {
  const tableRows: Array<{ sql?: string | null }> = await dataSource.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'share_links'`,
  );
  const tableSql = tableRows[0]?.sql ?? null;
  if (!tableSql) return [];

  const plainSql = tableSql.replace(/[`"']/g, '');
  const hasFilePaths = /\bfilePaths\b/.test(plainSql);
  const hasLegacyFilePath = /\bfilePath\b/.test(plainSql);

  const fixes: string[] = [];
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.startTransaction();

    if (!hasFilePaths) {
      await queryRunner.query(
        'ALTER TABLE "share_links" ADD COLUMN "filePaths" text',
      );
      fixes.push('share_links 缺少 filePaths 列，已补建可空列用于回填');
    }

    const countRows = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM "share_links"
       WHERE "filePaths" IS NULL OR "filePaths" = ''`,
    )) as unknown as Array<{ count: number | string }>;
    const nullCount = Number(countRows[0]?.count ?? 0);
    if (nullCount > 0) {
      if (hasLegacyFilePath) {
        await queryRunner.query(
          `UPDATE "share_links" SET "filePaths" = json_array("filePath")
           WHERE "filePaths" IS NULL OR "filePaths" = ''`,
        );
        fixes.push(`${nullCount} 行分享已用旧列 filePath 回填 filePaths`);
      } else {
        await queryRunner.query(
          `UPDATE "share_links" SET "filePaths" = '[]'
           WHERE "filePaths" IS NULL OR "filePaths" = ''`,
        );
        fixes.push(`${nullCount} 行分享缺少路径数据，filePaths 已置为空数组`);
      }
    }

    await queryRunner.commitTransaction();
  } catch (error) {
    await queryRunner.rollbackTransaction().catch(() => undefined);
    throw new Error(
      `旧分享数据规整失败：${error instanceof Error ? error.message : String(error)}。` +
        '请备份数据库后用 SQL 检查 share_links 的 filePath / filePaths 数据',
    );
  } finally {
    await queryRunner.release();
  }

  return fixes;
}

/**
 * 只校验、不改动结构：启动时确认核心表与当前字段可用。
 * 缺表或结构不一致时抛出带原因和操作指引的错误。
 */
export async function assertSchemaReady(
  dataSource: DataSource,
  hint = '请先执行 pnpm db:sync 同步数据库',
): Promise<void> {
  try {
    await dataSource.query('SELECT id, role FROM users LIMIT 1');
    await dataSource.query(
      'SELECT id, filePaths, remark, enabled FROM share_links LIMIT 1',
    );
    await dataSource.query('SELECT id, contentHash FROM file_entries LIMIT 1');
    await dataSource.query(
      'SELECT id, offlineReason FROM app_versions LIMIT 1',
    );
  } catch (error) {
    throw new Error(
      '数据库缺少当前版本所需的表或列（校验 users / share_links / file_entries / app_versions 失败）：' +
        `${error instanceof Error ? error.message : String(error)}。${hint}`,
    );
  }

  // 列存在不代表结构已是当前形态：旧库可能留着 filePath / shareType 且 filePaths 可空，
  // 这些情况必须显式失败，不能进入“看似可用、写入时才报错”的中间态。
  const tableRows: Array<{ sql?: string | null }> = await dataSource.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'share_links'`,
  );
  const tableSql = tableRows[0]?.sql ?? '';
  const plainSql = tableSql.replace(/[`"']/g, '');
  const issues: string[] = [];
  if (!tableSql) {
    issues.push('缺少 share_links 表');
  } else {
    if (/\bfilePath\b/.test(plainSql)) issues.push('仍存在旧版列 filePath');
    if (/\bshareType\b/.test(plainSql)) issues.push('仍存在旧版列 shareType');
    if (!/\bfilePaths\b\s+text\s+NOT NULL/.test(plainSql)) {
      issues.push('filePaths 未声明为 NOT NULL');
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `share_links 结构落后于当前实体（${issues.join('；')}）。${hint}`,
    );
  }
}

async function snapshot(dataSource: DataSource): Promise<SchemaObject[]> {
  return await dataSource.query(
    `SELECT type, name, sql FROM sqlite_master
     WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
     ORDER BY type, name`,
  );
}
