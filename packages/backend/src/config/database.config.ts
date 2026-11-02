import { registerAs } from '@nestjs/config';
import { join, resolve } from 'path';

export interface DatabaseConfig {
  path: string;
  synchronize: boolean;
}

export const databaseConfigFactory = registerAs('db', (): DatabaseConfig => ({
  path: resolve(
    process.env.DB_PATH ?? join(process.cwd(), 'storage', 'vakao.db'),
  ),
  // 开发环境开关：true 时启动自动同步表结构并播种；false 时完全不碰结构。
  // 生产环境会忽略该开关（见 DatabaseBootstrapService），只接受 `pnpm db:sync`。
  synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true',
}));
