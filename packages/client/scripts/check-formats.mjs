/**
 * 构建前校验入口：注册 `@/` 解析后直接执行 check-formats.ts
 * （Node 24 原生支持 TS 类型擦除，无需额外构建步骤）
 */
import { register } from 'node:module';

register('./alias-loader.mjs', import.meta.url);
await import('./check-formats.ts');
