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
  SwaggerModule.setup('docs', app, swaggerDoc);
}
