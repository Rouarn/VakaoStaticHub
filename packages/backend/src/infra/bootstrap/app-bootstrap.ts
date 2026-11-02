import { ConsoleLogger, Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { mkdir } from 'node:fs/promises';
import type { ServerConfig } from '../../config/server.config.js';
import type { FileConfig } from '../../config/file.config.js';
import { ResponseInterceptor } from '../../common/http/response.interceptor.js';
import { HttpExceptionFilter } from '../../common/http/http-exception.filter.js';
import { LoggingInterceptor } from '../../common/http/logging.interceptor.js';
import { createValidationPipe } from '../../common/http/validation.js';
import { setupSwagger } from '../swagger/swagger.setup.js';
import { setupSpaFallback } from './spa-fallback.js';

export class CustomLogger extends ConsoleLogger {
  protected getTimestamp(): string {
    return new Date().toLocaleString('sv-SE', { hour12: false });
  }
}

function setupCors(app: INestApplication, serverCfg?: ServerConfig): void {
  // CORS 来源：默认不开放跨域（生产同源部署、开发走 Vite proxy）；
  // 需要跨域时通过 CORS_ORIGIN 配置逗号分隔的来源白名单，填 '*' 表示放通全部来源
  const corsOrigins = (serverCfg?.corsOrigin ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  // 注意：cors 包对数组形式的 origin 是逐项全等比较，传 ['*'] 匹配不上任何来源，
  // 必须把 '*' 还原成字符串通配符才生效
  let corsOrigin: string | string[] | boolean = false;
  if (corsOrigins.includes('*')) {
    corsOrigin = '*';
  } else if (corsOrigins.length > 0) {
    corsOrigin = corsOrigins;
  }
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

function setupHelmet(app: INestApplication): void {
  app.use(
    helmet({
      // 保守开启 CSP：只对 HTML/SPA 响应生效（浏览器对非 HTML 会忽略 CSP header），
      // 覆盖 Vite SPA 内联脚本、Swagger UI eval、文件预览 iframe（PDF blob:、HTML 跨源嵌入）
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
          mediaSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
          frameSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http:'],
          fontSrc: ["'self'", 'data:'],
          workerSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      // 以下三项保持关闭 / 放开，是 4e54035、e8cf756 两次提交专门修好的行为，不可回退：
      // - COEP 关闭：允许 document 跨源嵌入第三方（iframe）
      // - CORP cross-origin：允许静态资源图片/视频/APK 被任何跨源站点嵌入
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
}

function setupBodyParsers(
  app: INestApplication,
  serverCfg?: ServerConfig,
): void {
  app.use(
    json({
      limit: serverCfg?.bodyLimit ?? '10mb',
    }),
  );
  app.use(urlencoded({ extended: true }));
}

function setupGlobalEnhancers(app: INestApplication): void {
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(createValidationPipe());
}

/**
 * 按既有顺序装配基础设施，返回监听端口。
 */
export async function configureApp(
  app: INestApplication,
  configService: ConfigService,
): Promise<number> {
  const serverCfg = configService.get<ServerConfig>('server');
  const fileCfg = configService.get<FileConfig>('files');
  const staticPrefix = serverCfg?.staticPrefix ?? 'static';

  app.setGlobalPrefix(staticPrefix);
  setupCors(app, serverCfg);
  setupHelmet(app);
  setupBodyParsers(app, serverCfg);
  setupGlobalEnhancers(app);

  setupSwagger(app, configService);

  if (fileCfg?.root) {
    await mkdir(fileCfg.root, { recursive: true });
  }

  await setupSpaFallback(app, staticPrefix);

  return serverCfg?.port ?? 9865;
}

export function logStartupInfo(port: number): void {
  const logger = new Logger('Bootstrap');
  logger.log(`客户端已启动，监听端口：http://localhost:9867`);
  logger.log(`服务端已启动，监听端口: http://localhost:${port}`);
}
