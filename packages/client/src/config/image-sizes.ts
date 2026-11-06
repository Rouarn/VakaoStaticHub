/**
 * 图片请求尺寸的唯一配置源
 *
 * 后端会把宽高夹紧到 16–4096 并按 16 的步长向下对齐，
 * 因此这里统一使用 16 的整数倍，避免同一张图因为零散尺寸
 * 生成多份缩略图缓存。页面需要图片时只能引用这里的档位，
 * 禁止在组件里散写数字。
 */
export const IMAGE_SIZES = {
  /** 列表缩略图：文件网格卡片、重复文件列表 */
  thumbnail: 480,
  /** 预览大图：预览弹窗与独立预览页 */
  preview: 1600,
  /** 分享页内联展示的图片 */
  share: 1280,
} as const;

export type ImageTier = keyof typeof IMAGE_SIZES;

/** 缩略图质量，与后端允许的 30–95 区间对齐 */
export const IMAGE_QUALITY = 78;
