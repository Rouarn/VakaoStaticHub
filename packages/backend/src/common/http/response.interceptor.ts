import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@vakao/shared';

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'data' in value
  );
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        // @Res() 直写/文件流已发送响应时不再包裹
        if (response.headersSent) {
          return data;
        }
        // 已手工输出信封的接口保持原样，避免二次包裹
        if (isApiResponse(data)) {
          return data;
        }
        return {
          code: 200,
          message: '成功',
          data: data ?? null,
        };
      }),
    );
  }
}
