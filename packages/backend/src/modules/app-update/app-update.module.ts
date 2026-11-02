import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { AppUpgradeEventEntity } from '#/infra/database/entities/app-upgrade-event.entity.js';
import { AppVersionEntity } from '#/infra/database/entities/app-version.entity.js';
import { AppController } from './app.controller.js';
import { VersionController } from './version.controller.js';
import { ClientController } from './client.controller.js';
import { AppUpdateService } from './app-update.service.js';
import { VersionPublishService } from './version-publish.service.js';
import { VersionSchedulerService } from './version-scheduler.service.js';
import { AppUpdateStatsService } from './app-update-stats.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppVersionEntity,
      AppUpgradeEventEntity,
      FileEntryEntity,
    ]),
  ],
  controllers: [ClientController, AppController, VersionController],
  providers: [
    AppUpdateService,
    VersionPublishService,
    VersionSchedulerService,
    AppUpdateStatsService,
  ],
  exports: [AppUpdateService, AppUpdateStatsService],
})
export class AppUpdateModule {}
