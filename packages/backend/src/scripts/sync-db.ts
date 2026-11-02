/**
 * 唯一数据库同步脚本：`pnpm db:sync`
 *
 * 以实体定义为唯一 schema 来源：
 * - 库不存在 / 空库 → 建出全部表与索引
 * - 已有表但结构落后 → 加列/改列/建索引
 * - 结构一致 → 输出「无需变更」，不产生任何 DDL
 * 同时负责播种必要初始数据（默认管理员），幂等。
 *
 * 本地开发也可直接由 DB_SYNCHRONIZE=true 在启动时完成同样的同步；
 * 生产环境启动不自动改结构，结构变更一律走本脚本。
 */

import 'reflect-metadata';
import { mkdir, access, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { DATABASE_ENTITIES } from '../infra/database/database-entities.js';
import { syncSchema } from '../infra/database/ensure-schema.js';

const log = (message: string) => console.log(`[db:sync] ${message}`);

async function main(): Promise<void> {
  const dbPath = resolve(
    process.env.DB_PATH ?? join(process.cwd(), 'storage', 'vakao.db'),
  );
  log(`数据库文件：${dbPath}`);

  let fileExisted = true;
  try {
    await access(dbPath, constants.F_OK);
  } catch {
    fileExisted = false;
  }

  await mkdir(dirname(dbPath), { recursive: true });

  const dataSource = new DataSource({
    type: 'sqljs',
    location: dbPath,
    autoSave: true,
    synchronize: false,
    entities: DATABASE_ENTITIES,
  });
  await dataSource.initialize();

  try {
    const result = await syncSchema(dataSource);

    if (result.alreadyCurrent) {
      log(`无需变更：结构与实体定义一致（共 ${result.tables.length} 张表）`);
    } else {
      log(
        `差异摘要：新建表 ${result.createdTables.length} 个` +
          `${result.createdTables.length ? `（${result.createdTables.join(', ')}）` : ''}，` +
          `变更对象 ${result.changedObjects.length} 个` +
          `${result.changedObjects.length ? `（${result.changedObjects.join(', ')}）` : ''}，` +
          `删除对象 ${result.droppedObjects.length} 个` +
          `${result.droppedObjects.length ? `（${result.droppedObjects.join(', ')}）` : ''}`,
      );
    }

    for (const fix of result.legacyFixes) {
      log(`旧数据规整：${fix}`);
    }
    log(
      `当前表清单（${result.tables.length} 张）：${result.tables.join(', ')}`,
    );
    log(
      result.seededAdmin
        ? `已播种默认管理员账号：${result.seededAdmin}（密码：${process.env.AUTH_PASS ?? 'admin'}）`
        : 'users 表已有账号，跳过播种',
    );
  } catch (error) {
    if (!fileExisted) {
      await unlink(dbPath).catch(() => undefined);
    }
    throw error;
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    '[db:sync] 同步失败：',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
