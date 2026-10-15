import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { json, urlencoded } from 'express';
import * as express from 'express';
import helmet from 'helmet';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ResponseInterceptor } from './common/response.interceptor.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ServerConfig } from './config/server.config.js';
import type { FileConfig } from './config/file.config.js';

class CustomLogger extends ConsoleLogger {
  protected getTimestamp(): string {
    return new Date().toLocaleString('sv-SE', { hour12: false });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new CustomLogger(),
  });
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  const serverCfg = configService.get<ServerConfig>('server');
  const fileCfg = configService.get<FileConfig>('files');

  app.setGlobalPrefix(serverCfg?.staticPrefix ?? 'static');

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

  app.use(
    helmet({
      contentSecurityPolicy: false, // SPA 内联脚本与 Swagger 需要，先关闭 CSP
      crossOriginEmbedderPolicy: false, // 关闭 COEP，允许跨源嵌入
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // 静态资源服务需要允许跨源嵌入，放开 CORP
    }),
  );

  app.use(
    json({
      limit: serverCfg?.bodyLimit ?? '10mb',
    }),
  );
  app.use(urlencoded({ extended: true }));

  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ResponseInterceptor(),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (serverCfg?.enableSwagger !== false) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Vakao Static Hub 接口文档')
      .setDescription('静态资源托管服务的后端 API 文档')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, swaggerDoc);
  }

  if (fileCfg?.root) {
    await mkdir(fileCfg.root, { recursive: true });
  }

  const staticPrefix = serverCfg?.staticPrefix ?? 'static';
  const webDir = join(process.cwd(), 'web');

  try {
    await access(webDir);
    app.use(express.static(webDir));
    const indexHtmlPath = join(webDir, 'index.html');

    try {
      await access(indexHtmlPath);
      const httpAdapter = app.getHttpAdapter();
      const instance = httpAdapter.getInstance() as express.Application;

      const hasExtension = (path: string) =>
        /\.[a-zA-Z0-9]+$/.test(path.split('?')[0]);
      const isApiPath = (path: string) =>
        path.startsWith(`/${staticPrefix}`) || path.startsWith('/docs');

      instance.use(
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (
            req.method === 'GET' &&
            !hasExtension(req.path) &&
            !isApiPath(req.path) &&
            (req.headers.accept || '').includes('text/html')
          ) {
            return res.sendFile(indexHtmlPath);
          }
          return next();
        },
      );
    } catch {
      // index.html not found
    }
  } catch {
    // webDir not found
  }

  const port = serverCfg?.port ?? 9865;
  await app.listen(port);

  logger.log(`客户端已启动，监听端口：http://localhost:9867`);
  logger.log(`服务端已启动，监听端口: http://localhost:${port}`);
}

void bootstrap();
