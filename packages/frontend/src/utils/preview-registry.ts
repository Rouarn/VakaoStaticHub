import type { Component } from 'vue';

/**
 * 预览注册表（preview-registry 机制的唯一配置点）
 *
 * 文件卡片弹窗与独立预览页共用同一套「格式 → 预览组件」分发逻辑：
 * 新增格式只需在 registerBuiltinPreviews() 追加一条注册项，
 * 预览组件懒加载，避免阻塞首屏。
 *
 * TODO(下一轮)：注册各格式预览组件 —
 * 图片 / 视频（封面+玻璃播放按钮+dayjs 时长）/ 音频（渐变底+波形）/
 * 文本·代码（highlight.js 按语言）/ Markdown / HTML（sandbox iframe）/
 * PDF / Word / Excel / 压缩包 / 默认兜底。
 */

export interface PreviewRegistration {
  /** 匹配的扩展名（小写、不含点） */
  extensions: string[];
  /** 预览组件懒加载器 */
  loader: () => Promise<Component>;
}

const registry: PreviewRegistration[] = [];

/** 注册一组扩展名对应的预览组件 */
export function registerPreview(registration: PreviewRegistration): void {
  registry.push(registration);
}

/** 按文件名解析预览组件加载器；未命中返回 null（调用方走默认兜底） */
export function resolvePreview(
  filename: string,
): (() => Promise<Component>) | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const hit = registry.find((item) => item.extensions.includes(ext));
  return hit?.loader ?? null;
}

/** 注册内置格式预览（下一轮填实，此处先保证机制可用） */
export function registerBuiltinPreviews(): void {
  if (registry.length > 0) return;
  // 示例（下一轮替换为真实组件）：
  // registerPreview({ extensions: ['png', 'jpg', ...], loader: () => import('@/components/preview/image-preview.vue') });
}
