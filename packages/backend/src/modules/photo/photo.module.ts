/**
 * 图片服务模块
 * 提供随机图片获取和处理功能
 *
 * 优化说明：
 * - 导入 FilesModule 以复用 ImageProcessorService
 * - 移除重复的图片处理逻辑
 */

import { Module } from '@nestjs/common';
import { ResourceRootsModule } from '#/infra/resource-roots/resource-roots.module.js';
import { FilesModule } from '../files/files.module.js';
import { PhotoController } from './photo.controller.js';
import { PhotoService } from './photo.service.js';

/**
 * 图片模块类
 * 导入资源根目录模块和文件模块，注册图片控制器和服务
 */
@Module({
  imports: [ResourceRootsModule, FilesModule],
  controllers: [PhotoController],
  providers: [PhotoService],
})
export class PhotoModule {}
