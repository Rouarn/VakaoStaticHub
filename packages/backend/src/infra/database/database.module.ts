import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { FileEntryEntity } from './entities/file-entry.entity.js';
import { ShareLinkEntity } from './entities/share-link.entity.js';
import { ShareAccessLogEntity } from './entities/share-access-log.entity.js';
import { AppVersionEntity } from './entities/app-version.entity.js';
import { AppUpgradeEventEntity } from './entities/app-upgrade-event.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { AuditLogEntity } from './entities/audit-log.entity.js';
import { SchemaMigrationService } from './schema-migration.service.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const database = configService.get<string>('db.path');
        if (database) {
          await mkdir(dirname(database), { recursive: true });
        }
        // 库文件不存在时视为首次部署，强制开启一次 synchronize 自动建表；
        // 已存在的库遵循 DB_SYNCHRONIZE 配置（默认 false，避免实体变更意外 DROP/ALTER）
        let isFirstRun = false;
        if (database) {
          try {
            await access(database, constants.F_OK);
          } catch {
            isFirstRun = true;
          }
        }
        const configuredSynchronize =
          configService.get<boolean>('db.synchronize') ?? false;
        return {
          type: 'sqljs' as const,
          location: database,
          autoSave: true,
          synchronize: isFirstRun || configuredSynchronize,
          entities: [
            FileEntryEntity,
            ShareLinkEntity,
            ShareAccessLogEntity,
            AppVersionEntity,
            AppUpgradeEventEntity,
            UserEntity,
            AuditLogEntity,
          ],
        };
      },
    }),
  ],
  providers: [SchemaMigrationService],
})
export class DatabaseModule {}
