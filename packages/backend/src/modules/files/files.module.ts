import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { parseSize } from '#/common/utils/size.util.js';
import { FileEntryEntity } from '#/infra/database/entities/file-entry.entity.js';
import { ShareLinkEntity } from '#/infra/database/entities/share-link.entity.js';
import { ResourceRootsModule } from '#/infra/resource-roots/resource-roots.module.js';
import { FileIndexService } from './file-index.service.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { ImageProcessorService } from './image-processor.service.js';
import { CleanupService } from './cleanup.service.js';
import { ConfigurableFilesInterceptor } from '#/common/interceptors/configurable-files.interceptor.js';

@Module({
  imports: [
    ResourceRootsModule,
    TypeOrmModule.forFeature([FileEntryEntity, ShareLinkEntity]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        limits: {
          fileSize: parseSize(configService.get<string>('server.bodyLimit')),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    FileIndexService,
    ImageProcessorService,
    CleanupService,
    ConfigurableFilesInterceptor,
  ],
  exports: [FilesService, ImageProcessorService],
})
export class FilesModule {}
