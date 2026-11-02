import { ValidationPipe } from '@nestjs/common';

/**
 * 创建全局校验管道：未知字段直接拒绝，入参按 DTO 类型转换
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
