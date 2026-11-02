import { Controller, Get } from '@nestjs/common';

/** 健康检查端点：公开访问，响应体由统一信封包裹为 { code, message, data } */
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
