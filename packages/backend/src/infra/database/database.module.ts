import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_ENTITIES } from './database-entities.js';
import { DatabaseBootstrapService } from './database-bootstrap.service.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const database = configService.get<string>('db.path');
        const isProduction = configService.get<boolean>('db.isProduction');
        if (database) {
          await mkdir(dirname(database), { recursive: true });
        }
        // 生产环境不自动建表：schema 只来自 `pnpm db:sync`
        if (isProduction && database) {
          try {
            await access(database, constants.F_OK);
          } catch {
            throw new Error(
              `数据库文件不存在：${database}。请先执行 pnpm db:sync 同步数据库`,
            );
          }
        }
        return {
          type: 'sqljs' as const,
          location: database,
          autoSave: true,
          synchronize: false,
          entities: DATABASE_ENTITIES,
        };
      },
    }),
  ],
  providers: [DatabaseBootstrapService],
})
export class DatabaseModule {}
