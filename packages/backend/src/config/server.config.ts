import { registerAs } from '@nestjs/config';

export interface ServerConfig {
  port: number;
  bodyLimit: string;
  staticPrefix: string;
  /** 跨域来源白名单（逗号分隔），空字符串表示不开放跨域，'*' 表示放通全部来源 */
  corsOrigin: string;
  /** 是否挂载 Swagger 文档（/docs），生产环境建议关闭 */
  enableSwagger: boolean;
}

export const serverConfigFactory = registerAs('server', (): ServerConfig => ({
  port: Number(process.env.PORT ?? 9865),
  bodyLimit: process.env.BODY_LIMIT ?? '10mb',
  // 统一去掉首尾斜杠，避免 setGlobalPrefix 与路径判断出现双斜杠
  staticPrefix: (process.env.STATIC_PREFIX ?? 'static').replace(
    /^\/+|\/+$/g,
    '',
  ),
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  enableSwagger: (process.env.ENABLE_SWAGGER ?? 'true') === 'true',
}));
