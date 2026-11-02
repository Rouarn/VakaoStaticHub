import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { ShareAccessLogEntity } from '#/infra/database/entities/share-access-log.entity.js';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';
import { ShareAccessService } from './share-access.service.js';
import { ShareCleanupService } from './share-cleanup.service.js';
import { FilesModule } from '../files/files.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShareLinkEntity, ShareAccessLogEntity]),
    FilesModule,
  ],
  controllers: [ShareController],
  providers: [ShareService, ShareAccessService, ShareCleanupService],
  exports: [ShareService],
})
export class ShareModule {}
