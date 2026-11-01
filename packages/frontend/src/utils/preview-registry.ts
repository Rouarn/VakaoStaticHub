/**
 * 预览注册表：文件类型 → 预览组件的唯一配置点。
 *
 * 每种可内嵌预览的类型注册一个懒加载组件（动态 import，点击预览时才拉取
 * 对应 chunk，互不拖入首屏）；卡片与独立预览页共用 resolvePreview 分发。
 *
 * 预览组件统一约定：
 *   props  — { src: string; filename?: string }
 *   emits  — ready / load / error(err: Error)
 *   expose — reload() / destroy()
 *
 * PPT 等浏览器无内建渲染器的类型不在此注册：走 isPptExternal 新标签打开，
 * 其余未注册类型由消费方回退为下载引导。
 */
import type { Component } from 'vue';
import {
  getFileExtension,
  videoExtensions,
  audioExtensions,
  imageExtensions,
  pdfExtensions,
  wordExtensions,
  excelExtensions,
  markdownExtensions,
  textExtensions,
  codeExtensions,
  htmlExtensions,
} from '@/utils/file-types';

export interface PreviewEntry {
  /** 命中的扩展名（小写，不含点） */
  extensions: string[];
  /** 懒加载预览组件 */
  loader: () => Promise<Component>;
}

const previewEntries: PreviewEntry[] = [
  {
    extensions: videoExtensions,
    loader: () => import('@/views/file-list/components/video-file-preview.vue'),
  },
  {
    extensions: audioExtensions,
    loader: () => import('@/views/file-list/components/audio-file-preview.vue'),
  },
  {
    extensions: imageExtensions,
    loader: () =>
      import('@/views/file-preview/components/image-file-viewer.vue'),
  },
  {
    extensions: pdfExtensions,
    loader: () => import('@/views/file-list/components/pdf-file-preview.vue'),
  },
  {
    extensions: wordExtensions,
    loader: () => import('@/views/file-list/components/docx-file-preview.vue'),
  },
  {
    extensions: excelExtensions,
    loader: () => import('@/views/file-list/components/xlsx-file-preview.vue'),
  },
  {
    extensions: markdownExtensions,
    loader: () =>
      import('@/views/file-list/components/markdown-file-preview.vue'),
  },
  {
    extensions: [...textExtensions, ...codeExtensions],
    loader: () => import('@/views/file-list/components/text-file-preview.vue'),
  },
  {
    extensions: htmlExtensions,
    loader: () => import('@/views/file-list/components/html-file-preview.vue'),
  },
];

/** 解析结果：component 内嵌渲染 / unsupported 回退下载引导 */
export type PreviewResolution =
  | { kind: 'component'; loader: () => Promise<Component> }
  | { kind: 'unsupported' };

export const resolvePreview = (path: string): PreviewResolution => {
  const ext = getFileExtension(path);
  const entry = previewEntries.find((e) => e.extensions.includes(ext));
  return entry
    ? { kind: 'component', loader: entry.loader }
    : { kind: 'unsupported' };
};

const prefetched = new Set<string>();

/**
 * 浏览器空闲时预取该文件对应的预览组件 chunk（含其依赖的渲染库），
 * 首次点击预览时大概率已在缓存中。不阻塞首屏；省流模式跳过；失败允许重试。
 */
export const prefetchPreview = (path: string): void => {
  const ext = getFileExtension(path);
  if (prefetched.has(ext)) return;

  const resolution = resolvePreview(path);
  if (resolution.kind !== 'component') return;

  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (conn?.saveData) return;

  prefetched.add(ext);

  const schedule: (cb: () => void) => void =
    'requestIdleCallback' in window
      ? (cb) => window.requestIdleCallback(cb, { timeout: 3000 })
      : (cb) => window.setTimeout(cb, 1);

  schedule(() => {
    resolution.loader().catch(() => {
      prefetched.delete(ext);
    });
  });
};
