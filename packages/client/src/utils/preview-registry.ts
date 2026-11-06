import type { Component } from 'vue';
import type {
  PreviewLoader,
  PreviewRegistration,
} from '@/components/preview/types';

/**
 * 预览注册表（preview-registry 机制的唯一配置点）
 *
 * - 文件卡片弹窗与独立预览页共用 resolvePreview() 分发
 * - 每个格式一个独立组件，全部通过动态 import 懒加载；
 *   vite.config.ts 的 manualChunks 对这些库返回 undefined，走默认分包，
 *   避免 __vitePreload 助手把预览库拖进首屏
 * - 按扩展名注册，未命中返回 null，调用方降级到默认元信息视图
 */

const registry: PreviewRegistration[] = [];

const lazy =
  (load: () => Promise<{ default: Component }>): PreviewLoader =>
  () =>
    load().then((mod) => mod.default);

export function registerPreview(registration: PreviewRegistration): void {
  registry.push(registration);
}

/** 按文件名解析预览组件加载器；未命中返回 null（调用方走默认兜底） */
export function resolvePreview(filename: string): PreviewLoader | null {
  const idx = filename.lastIndexOf('.');
  const ext = idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
  const hit = registry.find((item) => item.extensions.includes(ext));
  return hit?.loader ?? null;
}

/** 注册内置格式预览（幂等，重复调用不会重复注册） */
export function registerBuiltinPreviews(): void {
  if (registry.length > 0) return;

  registerPreview({
    extensions: [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'avif',
      'bmp',
      'svg',
      'ico',
      'tiff',
    ],
    loader: lazy(() => import('@/components/preview/image-preview.vue')),
  });
  registerPreview({
    extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'ogv', 'm4v'],
    loader: lazy(() => import('@/components/preview/video-preview.vue')),
  });
  registerPreview({
    extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus'],
    loader: lazy(() => import('@/components/preview/audio-preview.vue')),
  });
  registerPreview({
    extensions: [
      'txt',
      'log',
      'json',
      'xml',
      'yaml',
      'yml',
      'toml',
      'ini',
      'conf',
      'csv',
      'ts',
      'tsx',
      'js',
      'jsx',
      'vue',
      'css',
      'scss',
      'less',
      'py',
      'go',
      'java',
      'rs',
      'sql',
      'sh',
      'bash',
      'env',
      'gitignore',
    ],
    loader: lazy(() => import('@/components/preview/text-preview.vue')),
  });
  registerPreview({
    extensions: ['md', 'markdown'],
    loader: lazy(() => import('@/components/preview/markdown-preview.vue')),
  });
  registerPreview({
    extensions: ['html', 'htm'],
    loader: lazy(() => import('@/components/preview/html-preview.vue')),
  });
  registerPreview({
    extensions: ['pdf'],
    loader: lazy(() => import('@/components/preview/pdf-preview.vue')),
  });
  registerPreview({
    extensions: ['doc', 'docx'],
    loader: lazy(() => import('@/components/preview/word-preview.vue')),
  });
  registerPreview({
    extensions: ['xls', 'xlsx'],
    loader: lazy(() => import('@/components/preview/excel-preview.vue')),
  });
  registerPreview({
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'],
    loader: lazy(() => import('@/components/preview/archive-preview.vue')),
  });
}
