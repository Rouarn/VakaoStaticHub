import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 解析 backend 包根目录的绝对路径。
 *
 * 项目是 ESM（package.json "type": "module"），__dirname 不可用，
 * 需要用 import.meta.url + fileURLToPath 推导。
 *
 * dist 输出：packages/backend/dist/common/utils/backend-root.util.js
 *   → 向上 3 级到 packages/backend/
 * src 源码：packages/backend/src/common/utils/backend-root.util.ts
 *   → 向上 3 级到 packages/backend/
 *
 * 多试几级向上查找 package.json，命中即返回；都不命中时 fallback 到 cwd。
 */
export function getBackendRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // 从两级到四级逐层向上找 package.json，命中哪个返回哪个
  for (let level = 2; level <= 4; level++) {
    const dir = resolve(currentDir, ...Array(level).fill('..'));
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
  }

  return process.cwd();
}
