import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { ServerConfig } from '../../config/server.config.js';

/**
 * 挂载 Swagger 文档（路径保持 /docs 与 /docs-json）
 */
export function setupSwagger(
  app: INestApplication,
  configService: ConfigService,
): void {
  const serverCfg = configService.get<ServerConfig>('server');
  if (serverCfg?.enableSwagger === false) {
    return;
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vakao Static Hub 接口文档')
    .setDescription('静态资源托管服务的后端 API 文档')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  // createDocument 会把 global prefix（/static）写进每条 path，
  // 因此文档里的 path 就是客户端实际调用的完整路径（如 /static/files/...）。
  // setup 必须关闭 useGlobalPrefix：文档挂在 /docs，绝不能再叠加一次前缀，
  // 否则会出现 /static/static/... 的重复路径。
  SwaggerModule.setup('docs', app, swaggerDoc, {
    useGlobalPrefix: false,
    swaggerOptions: { url: '/docs-json' },
  });
}
