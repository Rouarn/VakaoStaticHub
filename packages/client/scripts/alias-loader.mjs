/**
 * Node 侧的 `@/` 别名解析（仅给构建前校验脚本用）
 *
 * 校验脚本要在 Node 中直接加载 src 下的 TS 源码，而 Vite 的 `@/` 别名
 * 只在打包环境下有效；这里补一个最小 resolve hook，避免为此引入 loader 依赖。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url);
    return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
}
