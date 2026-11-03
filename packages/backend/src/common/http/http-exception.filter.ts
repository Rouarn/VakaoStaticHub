/**
 * HTTP 异常过滤器
 * 统一处理应用中的异常，返回标准化的错误响应
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * HTTP 异常过滤器类
 * 捕获所有异常并转换为统一的 JSON 响应格式
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /**
   * 捕获和处理异常
   * @param exception 捕获的异常对象
   * @param host 参数主机，用于获取响应对象
   */
  catch(exception: unknown, host: ArgumentsHost) {
    // 获取 HTTP 响应对象
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    // 默认状态码和消息
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器错误';

    // 处理 HttpException
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const r = response as { message?: string; error?: string };
        message = r.message ?? r.error ?? message;
      } else {
        message = exception.message || message;
      }
    } else if (exception instanceof Error) {
      // 处理其他 Error 类型的异常
      message = exception.message || message;
    }

    // 错误响应禁止任何中间层缓存：CDN 一旦缓存 4xx/5xx，
    // 源站恢复后仍会持续把错误页返回给用户（线上曾出现 EdgeOne 缓存旧 404 的事故）
    res.setHeader('Cache-Control', 'no-store, must-revalidate');

    // 返回统一格式的错误响应
    res.status(status).json({
      code: status,
      message,
      data: null,
    });
  }
}
