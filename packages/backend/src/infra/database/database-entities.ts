import { FileEntryEntity } from './entities/file-entry.entity.js';
import { ShareLinkEntity } from './entities/share-link.entity.js';
import { ShareAccessLogEntity } from './entities/share-access-log.entity.js';
import { AppVersionEntity } from './entities/app-version.entity.js';
import { AppUpgradeEventEntity } from './entities/app-upgrade-event.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { AuditLogEntity } from './entities/audit-log.entity.js';

/**
 * 全量实体清单，是数据库 schema 的唯一来源。
 * 开发启动的 ensureSchema、db:init 脚本与 TypeORM 运行时连接共用这一份清单。
 */
export const DATABASE_ENTITIES = [
  FileEntryEntity,
  ShareLinkEntity,
  ShareAccessLogEntity,
  AppVersionEntity,
  AppUpgradeEventEntity,
  UserEntity,
  AuditLogEntity,
];
