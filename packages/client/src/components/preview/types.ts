import type { Component } from 'vue';

/**
 * 预览组件统一契约：所有预览组件接收同一组 props，
 * 由 preview-registry 按文件类别解析后由预览弹窗动态挂载。
 */
export interface PreviewProps {
  /** 文件访问地址（后端 /static/files/... 或任意远程 URL） */
  src: string;
  /** 文件名，用于语言识别与展示 */
  filename: string;
  /** 字节大小，用于超大文件拦截与元信息展示 */
  size: number;
  /** 强制下载地址（可选，媒体错误态用；缺省时不展示下载动作） */
  downloadSrc?: string;
}

export type PreviewLoader = () => Promise<Component>;

/** 预览弹窗的单个目标（列表页与独立预览页共用） */
export interface PreviewTarget {
  filename: string;
  /** 预览地址（内联） */
  src: string;
  /** 强制下载地址 */
  downloadSrc: string;
  size: number;
}
