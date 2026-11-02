import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';

/**
 * 分片上传拦截器（带可配置的单文件大小上限）
 * 与 ConfigurableFilesInterceptor 同模式：启动时从 ConfigService 读配置，
 * 避免 multer 装饰器静态求值拿不到运行时 config 的问题。
 * 配置收敛到 files.chunkFileSizeLimit（默认 100MB，环境变量 CHUNK_FILE_SIZE_LIMIT 覆盖）。
 * 字段名同时接受 `chunk`（前端现状）与 `file`（接口文档约定），保持两侧契约不变。
 */
@Injectable()
export class ConfigurableChunkFileInterceptor implements NestInterceptor {
  private readonly interceptor: NestInterceptor;

  constructor(private readonly configService: ConfigService) {
    const fileSize =
      this.configService.get<number>('files.chunkFileSizeLimit') ??
      100 * 1024 * 1024;
    const InterceptorClass = FileFieldsInterceptor(
      [
        { name: 'chunk', maxCount: 1 },
        { name: 'file', maxCount: 1 },
      ],
      { limits: { fileSize } },
    );
    this.interceptor = new InterceptorClass();
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    return this.interceptor.intercept(context, next);
  }
}
