import dayjs from 'dayjs';

/**
 * 文件格式判定与展示工具（唯一配置点）
 *
 * 扩展名分组同时驱动三处：卡片渲染、图标选择、preview-registry 注册。
 * 新增格式只需在这里的映射表追加，避免多处分叉。
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
  | 'archive'
  | 'other';

const KIND_BY_EXT: Record<string, FileKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  svg: 'image',
  ico: 'image',
  tiff: 'image',

  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  ogv: 'video',
  m4v: 'video',

  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  aac: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  opus: 'audio',

  txt: 'text',
  log: 'text',
  json: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  toml: 'text',
  ini: 'text',
  conf: 'text',
  csv: 'text',
  ts: 'text',
  tsx: 'text',
  js: 'text',
  jsx: 'text',
  vue: 'text',
  css: 'text',
  scss: 'text',
  less: 'text',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',

  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  csvx: 'excel',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
};

/** 取出小写扩展名（不含点） */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

export function getFileKind(filename: string): FileKind {
  const ext = getExtension(filename);
  if (ext === 'csv') return 'text';
  return KIND_BY_EXT[ext] ?? 'other';
}

/** 可按文件自身能力预览的格式（其余走默认元信息兜底） */
export function isPreviewable(filename: string): boolean {
  return getFileKind(filename) !== 'other';
}

/** 支持浏览器原生流式预览的媒体格式 */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'ogv',
  'm4v',
];
export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'm4a',
  'opus',
];

export function isVideo(filename: string): boolean {
  return VIDEO_EXTENSIONS.includes(getExtension(filename));
}

export function isAudio(filename: string): boolean {
  return AUDIO_EXTENSIONS.includes(getExtension(filename));
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
