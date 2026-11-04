import { registerAs } from '@nestjs/config';
import { join, resolve } from 'path';
import { getBackendRoot } from '../common/utils/backend-root.util.js';

export interface DatabaseConfig {
  path: string;
  synchronize: boolean;
  /** 是否运行在生产环境（生产环境忽略 DB_SYNCHRONIZE，只做结构校验） */
  isProduction: boolean;
}

export const databaseConfigFactory = registerAs('db', (): DatabaseConfig => {
  const backendRoot = getBackendRoot();
  return {
    path: resolve(
      process.env.DB_PATH ?? join(backendRoot, 'data', 'vakao.db'),
    ),
  // 开发环境开关：true 时启动自动同步表结构并播种；false 时完全不碰结构。
  // 生产环境会忽略该开关（见 DatabaseBootstrapService），只接受 `pnpm db:sync`。
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true',
    isProduction: process.env.NODE_ENV === 'production',
  };
});
