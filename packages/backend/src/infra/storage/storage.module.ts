import { Module } from '@nestjs/common';

/**
 * 存储模块：静态文件/APK 输出为无状态工具函数，无需 DI 提供者。
 * 保留模块边界，供后续有状态存储能力挂载。
 */
@Module({})
export class StorageModule {}
