import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import {
  CustomLogger,
  configureApp,
  logStartupInfo,
} from './infra/bootstrap/app-bootstrap.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new CustomLogger(),
  });
  const configService = app.get(ConfigService);

  const port = await configureApp(app, configService);
  await app.listen(port);

  logStartupInfo(port);
}

void bootstrap();
