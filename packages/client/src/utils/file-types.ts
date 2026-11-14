import dayjs from 'dayjs';

/**
 * 文件格式的唯一配置点
 *
 * `EXT_META` 是唯一主表：每一行 = 一个扩展名，带所属类别、标准 MIME、
 * 是否代表扩展名（同一 MIME 有多个扩展名时，只有代表扩展名参与反查）。
 *
 * 三处派生自此表，不再各自维护清单：
 * - 卡片图标/分类：getFileKind()
 * - 预览器选择：preview-registry 按类别注册，扩展名由 extensionsOfKind() 生成
 * - Content-Type 反查扩展名：extensionFromContentType()
 *
 * 新增格式只改这里；`scripts/check-formats.ts` 在构建前校验三者同步。
 */

export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'markdown'
  | 'html'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'slides'
  | 'archive'
  | 'other';

export interface FormatMeta {
  /** 所属类别，同时决定用哪个预览组件 */
  kind: Exclude<FileKind, 'other'>;
  /** 该格式的标准 Content-Type */
  mime: string;
  /** 同一 MIME 对应多个扩展名时，只有代表扩展名参与反查（如 jpg 代表 image/jpeg） */
  canonical?: boolean;
  /** 仅用于反查的 MIME 别名（如 image/vnd.microsoft.icon） */
  aliases?: string[];
}

export const EXT_META: Record<string, FormatMeta> = {
  // —— 图片 ——
  png: { kind: 'image', mime: 'image/png', canonical: true },
  jpg: { kind: 'image', mime: 'image/jpeg', canonical: true },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif', canonical: true },
  webp: { kind: 'image', mime: 'image/webp', canonical: true },
  avif: { kind: 'image', mime: 'image/avif', canonical: true },
  bmp: { kind: 'image', mime: 'image/bmp', canonical: true },
  svg: { kind: 'image', mime: 'image/svg+xml', canonical: true },
  ico: {
    kind: 'image',
    mime: 'image/x-icon',
    canonical: true,
    aliases: ['image/vnd.microsoft.icon'],
  },
  tiff: { kind: 'image', mime: 'image/tiff', canonical: true },

  // —— 视频 ——
  mp4: { kind: 'video', mime: 'video/mp4', canonical: true },
  mov: { kind: 'video', mime: 'video/quicktime', canonical: true },
  webm: { kind: 'video', mime: 'video/webm', canonical: true },
  mkv: { kind: 'video', mime: 'video/x-matroska', canonical: true },
  avi: { kind: 'video', mime: 'video/x-msvideo', canonical: true },
  ogv: { kind: 'video', mime: 'video/ogg', canonical: true },
  m4v: { kind: 'video', mime: 'video/x-m4v', canonical: true },

  // —— 音频 ——
  mp3: {
    kind: 'audio',
    mime: 'audio/mpeg',
    canonical: true,
    aliases: ['audio/mp3'],
  },
  wav: {
    kind: 'audio',
    mime: 'audio/wav',
    canonical: true,
    aliases: ['audio/x-wav'],
  },
  flac: {
    kind: 'audio',
    mime: 'audio/flac',
    canonical: true,
    aliases: ['audio/x-flac'],
  },
  aac: { kind: 'audio', mime: 'audio/aac', canonical: true },
  ogg: { kind: 'audio', mime: 'audio/ogg', canonical: true },
  m4a: {
    kind: 'audio',
    mime: 'audio/mp4',
    canonical: true,
    aliases: ['audio/x-m4a'],
  },
  opus: { kind: 'audio', mime: 'audio/opus', canonical: true },

  // —— 纯文本 / 代码 / 配置 ——
  txt: { kind: 'text', mime: 'text/plain', canonical: true },
  log: { kind: 'text', mime: 'text/plain' },
  json: { kind: 'text', mime: 'application/json', canonical: true },
  xml: {
    kind: 'text',
    mime: 'application/xml',
    canonical: true,
    aliases: ['text/xml'],
  },
  yaml: {
    kind: 'text',
    mime: 'text/yaml',
    canonical: true,
    aliases: ['application/yaml'],
  },
  yml: { kind: 'text', mime: 'text/yaml' },
  toml: { kind: 'text', mime: 'application/toml', canonical: true },
  ini: { kind: 'text', mime: 'text/plain' },
  conf: { kind: 'text', mime: 'text/plain' },
  csv: { kind: 'excel', mime: 'text/csv', canonical: true },
  ts: { kind: 'text', mime: 'text/plain' },
  tsx: { kind: 'text', mime: 'text/plain' },
  js: { kind: 'text', mime: 'text/javascript', canonical: true },
  jsx: { kind: 'text', mime: 'text/plain' },
  vue: { kind: 'text', mime: 'text/plain' },
  css: { kind: 'text', mime: 'text/css', canonical: true },
  scss: { kind: 'text', mime: 'text/plain' },
  less: { kind: 'text', mime: 'text/plain' },
  py: { kind: 'text', mime: 'text/x-python', canonical: true },
  go: { kind: 'text', mime: 'text/x-go', canonical: true },
  java: { kind: 'text', mime: 'text/x-java', canonical: true },
  rs: { kind: 'text', mime: 'text/x-rust', canonical: true },
  sql: {
    kind: 'text',
    mime: 'application/sql',
    canonical: true,
    aliases: ['text/x-sql'],
  },
  sh: { kind: 'text', mime: 'application/x-sh', canonical: true },
  bash: { kind: 'text', mime: 'text/x-shellscript', canonical: true },
  env: { kind: 'text', mime: 'text/plain' },
  gitignore: { kind: 'text', mime: 'text/plain' },

  // —— Markdown / HTML ——
  md: { kind: 'markdown', mime: 'text/markdown', canonical: true },
  markdown: { kind: 'markdown', mime: 'text/markdown' },
  html: { kind: 'html', mime: 'text/html', canonical: true },
  htm: { kind: 'html', mime: 'text/html' },

  // —— 文档 ——
  pdf: { kind: 'pdf', mime: 'application/pdf', canonical: true },
  doc: { kind: 'word', mime: 'application/msword', canonical: true },
  docx: {
    kind: 'word',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    canonical: true,
  },
  xls: { kind: 'excel', mime: 'application/vnd.ms-excel', canonical: true },
  xlsx: {
    kind: 'excel',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    canonical: true,
  },
  // 演示文稿前端没有渲染器，统一由服务端转 PDF 后走 PDF 预览
  ppt: {
    kind: 'slides',
    mime: 'application/vnd.ms-powerpoint',
    canonical: true,
  },
  pptx: {
    kind: 'slides',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    canonical: true,
  },

  // —— 压缩包 ——
  zip: {
    kind: 'archive',
    mime: 'application/zip',
    canonical: true,
    aliases: ['application/x-zip-compressed'],
  },
  rar: {
    kind: 'archive',
    mime: 'application/vnd.rar',
    canonical: true,
    aliases: ['application/x-rar-compressed'],
  },
  '7z': {
    kind: 'archive',
    mime: 'application/x-7z-compressed',
    canonical: true,
  },
  tar: { kind: 'archive', mime: 'application/x-tar', canonical: true },
  gz: { kind: 'archive', mime: 'application/gzip', canonical: true },
  tgz: { kind: 'archive', mime: 'application/gzip' },
};

/**
 * 唯一的扩展名归一化：去前导点、去空白、转小写。
 * 所有解析入口（getExtension / 反查表构建 / 校验脚本）都走这里，只归一一次。
 */
export function normalizeExtension(value: string): string {
  return value.trim().replace(/^\.+/, '').toLowerCase();
}

/** 取出小写扩展名（不含点）；没有扩展名返回空串 */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? normalizeExtension(filename.slice(idx + 1)) : '';
}

/** 文件名是否自带扩展名 */
export function hasExtension(filename: string): boolean {
  return getExtension(filename) !== '';
}

/** 按扩展名取类别；未知扩展名归 other */
export function getFileKind(filename: string): FileKind {
  return EXT_META[getExtension(filename)]?.kind ?? 'other';
}

/**
 * Content-Type → 扩展名（代表扩展名），无扩展名的同源链接靠 HEAD 探测时使用。
 * 只认主表里登记的 MIME 与其别名，未命中返回空串，由调用方回落默认预览。
 */
const EXTENSION_BY_MIME: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [ext, meta] of Object.entries(EXT_META)) {
    if (!meta.canonical) continue;
    map[meta.mime] = ext;
    for (const alias of meta.aliases ?? []) map[alias] = ext;
  }
  return map;
})();

/** 由响应头的 Content-Type 反查扩展名；无法确定时返回空串 */
export function extensionFromContentType(
  contentType: string | null | undefined,
): string {
  if (!contentType) return '';
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return normalizeExtension(EXTENSION_BY_MIME[mime] ?? '');
}

/** 可按文件自身能力预览的格式（其余走默认元信息兜底） */
export function isPreviewable(filename: string): boolean {
  return getFileKind(filename) !== 'other';
}

export function isImage(filename: string): boolean {
  return getFileKind(filename) === 'image';
}

/** 字节数格式化为可读文本 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exp;
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}

export function formatTime(ms: number): string {
  return dayjs(ms).format('YYYY-MM-DD HH:mm');
}

/** 秒数格式化为 mm:ss / hh:mm:ss（视频封面角标） */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
