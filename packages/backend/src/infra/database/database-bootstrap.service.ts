import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { assertSchemaReady, syncSchema } from './ensure-schema.js';

/**
 * 启动期数据库准备策略：
 * - 开发环境（NODE_ENV !== 'production'）：由 DB_SYNCHRONIZE 决定是否同步结构。
 *   true → 建表/改表 + 播种；false → 完全不碰结构，只做可用性校验。
 * - 生产环境：无论开关如何都不自动改结构；开关为 true 时打印警告并忽略。
 *   缺表/结构不一致时快速失败，提示使用 `pnpm db:sync`。
 */
@Injectable()
export class DatabaseBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseBootstrapService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const isProduction = process.env.NODE_ENV === 'production';
    const syncRequested =
      this.configService.get<boolean>('db.synchronize') ?? false;

    if (isProduction) {
      if (syncRequested) {
        this.logger.warn(
          '生产环境忽略 DB_SYNCHRONIZE=true，未自动修改数据库结构；结构变更请执行 pnpm db:sync',
        );
      }
      await assertSchemaReady(this.dataSource);
      this.logger.log('生产模式：未执行自动同步，schema 校验通过');
      return;
    }

    if (syncRequested) {
      const result = await syncSchema(this.dataSource);
      this.logger.log(
        `开发模式（DB_SYNCHRONIZE=true）：新建 ${result.createdTables.length} 张表，` +
          `变更 ${result.changedObjects.length} 个对象，删除 ${result.droppedObjects.length} 个对象，` +
          `当前共 ${result.tables.length} 张表`,
      );
      this.logger.log(
        result.seededAdmin
          ? `开发模式：已播种默认管理员账号 ${result.seededAdmin}`
          : '开发模式：users 表已有账号，跳过播种',
      );
      return;
    }

    this.logger.log(
      '开发模式（DB_SYNCHRONIZE=false）：跳过自动同步，开始校验 schema',
    );
    await assertSchemaReady(this.dataSource);
    this.logger.log('开发模式（DB_SYNCHRONIZE=false）：schema 校验通过');
  }
}
