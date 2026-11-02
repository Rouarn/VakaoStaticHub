/**
 * 供 ESLint 类型感知规则解析 .vue 导入的 shim
 * （vue-tsc 原生处理 .vue，会忽略本声明；仅 ESLint 走 wildcard 匹配）
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}
