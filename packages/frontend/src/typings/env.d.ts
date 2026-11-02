/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 基础地址；'origin' 表示取当前页面 origin，缺省走 vite 代理 */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
