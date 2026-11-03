import { registerAs } from '@nestjs/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本文件在 packages/backend/{src,dist}/config 下，向上四级即仓库根目录 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export interface ServerConfig {
  port: number;
  bodyLimit: string;
  staticPrefix: string;
  /** 前端构建产物目录（绝对路径），同源部署时由后端直接托管 */
  webDir: string;
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
  // 默认直接指向前端构建产物，不依赖进程工作目录；
  // WEB_DIR 可覆盖（相对路径按 cwd 解析），deploy 包即指向其 web/ 目录
  webDir: process.env.WEB_DIR
    ? resolve(process.env.WEB_DIR)
    : resolve(repoRoot, 'packages/frontend/dist'),
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  enableSwagger: (process.env.ENABLE_SWAGGER ?? 'true') === 'true',
}));
