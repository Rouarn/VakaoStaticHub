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
  /** 结构是否本来就与实体一致 */
  alreadyCurrent: boolean;
}

/**
 * 唯一的 schema 同步 + 播种实现：
 * - 开发启动（DB_SYNCHRONIZE=true）与 `pnpm db:sync` 脚本共用这一份逻辑
 * - schema 以实体定义为唯一来源：`dataSource.synchronize()` 建表/加列/改列/建索引
 * - 幂等：结构一致时不产生 DDL；users 非空时跳过播种
 */
export async function syncSchema(
  dataSource: DataSource,
): Promise<SyncSchemaResult> {
  const before = await snapshot(dataSource);
  await dataSource.synchronize();
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
    alreadyCurrent:
      createdTables.length === 0 &&
      changedObjects.length === 0 &&
      droppedObjects.length === 0,
  };
}

/**
 * 只校验、不改动结构：启动时确认核心表与当前字段可用。
 * 缺表或结构不一致时抛出指向 `pnpm db:sync` 的错误。
 */
export async function assertSchemaReady(dataSource: DataSource): Promise<void> {
  try {
    await dataSource.query('SELECT 1 FROM users LIMIT 1');
    await dataSource.query('SELECT id, filePaths FROM share_links LIMIT 1');
  } catch {
    throw new Error(
      '数据库未初始化或 schema 与当前版本不一致，请先执行 pnpm db:sync 同步数据库',
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
