import type { Component } from 'vue';
import type { PreviewLoader } from '@/components/preview/types';
import { getFileKind, type FileKind } from '@/utils/file-types';

/**
 * 预览注册表
 *
 * - 只按「类别」注册组件，扩展名清单来自 EXT_META（extensionsOfKind），
 *   这里不再手写扩展名数组，避免与主表分叉
 * - 每个类别一个组件，全部动态 import 懒加载；vite.config.ts 的
 *   manualChunks 对这些库返回 undefined，走默认分包，避免预览库进首屏
 * - 未命中返回 null，调用方降级到默认元信息视图
 */

type PreviewKind = Exclude<FileKind, 'other'>;

const loaders = new Map<PreviewKind, PreviewLoader>();

const lazy =
  (load: () => Promise<{ default: Component }>): PreviewLoader =>
  () =>
    load().then((mod) => mod.default);

/** 注册某类别的预览组件（重复注册后者覆盖前者） */
export function registerPreview(
  kind: PreviewKind,
  loader: PreviewLoader,
): void {
  loaders.set(kind, loader);
}

/** 按文件名解析预览组件加载器；未命中返回 null（调用方走默认兜底） */
export function resolvePreview(filename: string): PreviewLoader | null {
  const kind = getFileKind(filename);
  return kind === 'other' ? null : (loaders.get(kind) ?? null);
}

/** 已注册的类别（构建前校验用） */
export function registeredPreviewKinds(): PreviewKind[] {
  return [...loaders.keys()];
}

/** 注册内置类别预览（幂等） */
export function registerBuiltinPreviews(): void {
  if (loaders.size > 0) return;

  registerPreview(
    'image',
    lazy(() => import('@/components/preview/image-preview.vue')),
  );
  registerPreview(
    'video',
    lazy(() => import('@/components/preview/video-preview.vue')),
  );
  registerPreview(
    'audio',
    lazy(() => import('@/components/preview/audio-preview.vue')),
  );
  registerPreview(
    'text',
    lazy(() => import('@/components/preview/text-preview.vue')),
  );
  registerPreview(
    'markdown',
    lazy(() => import('@/components/preview/markdown-preview.vue')),
  );
  registerPreview(
    'html',
    lazy(() => import('@/components/preview/html-preview.vue')),
  );
  registerPreview(
    'pdf',
    lazy(() => import('@/components/preview/pdf-preview.vue')),
  );
  registerPreview(
    'word',
    lazy(() => import('@/components/preview/word-preview.vue')),
  );
  registerPreview(
    'excel',
    lazy(() => import('@/components/preview/excel-preview.vue')),
  );
  registerPreview(
    'slides',
    lazy(() => import('@/components/preview/pdf-preview.vue')),
  );
  registerPreview(
    'archive',
    lazy(() => import('@/components/preview/archive-preview.vue')),
  );
}
