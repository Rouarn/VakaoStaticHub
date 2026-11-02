import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { ResourceRootsModule } from './infra/resource-roots/resource-roots.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { ShareModule } from './modules/share/share.module.js';
import { RootsModule } from './modules/roots/roots.module.js';
import { PhotoModule } from './modules/photo/photo.module.js';
import { PlaceholderModule } from './modules/placeholder/placeholder.module.js';
import { HitokotoModule } from './modules/hitokoto/hitokoto.module.js';
import { AppUpdateModule } from './modules/app-update/app-update.module.js';
import { AuditLogModule } from './modules/audit-log/audit-log.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';

@Module({
  imports: [
    AppConfigModule,
    EventEmitterModule.forRoot({ global: true }),
    // 定时任务只在应用根模块注册一次，供 files/share/app-update 的 @Cron 使用
    ScheduleModule.forRoot(),
    // 全局限流：默认每 IP 每分钟 300 次；登录等敏感接口单独用 @Throttle 收紧
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    ResourceRootsModule,
    HealthModule,
    AuthModule,
    FilesModule,
    ShareModule,
    RootsModule,
    PhotoModule,
    PlaceholderModule,
    HitokotoModule,
    AppUpdateModule,
    AuditLogModule,
    MetricsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
