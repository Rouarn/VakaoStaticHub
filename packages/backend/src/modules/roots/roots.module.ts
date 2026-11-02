import { Module } from '@nestjs/common';
import { ResourceRootsModule } from '#/infra/resource-roots/resource-roots.module.js';
import { RootsController } from './roots.controller.js';
import { RootsService } from './roots.service.js';

@Module({
  imports: [ResourceRootsModule],
  controllers: [RootsController],
  providers: [RootsService],
})
export class RootsModule {}
