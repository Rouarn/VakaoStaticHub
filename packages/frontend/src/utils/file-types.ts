/** 视频（video.js 流式预览，后端 Range 边下边播） */
export const videoExtensions = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'ogv'];

/** 音频（自绘播放器，原生 audio 边下边播） */
export const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];

/** 图片（卡片 NImage 缩略图 / 独立页 img 预览） */
export const imageExtensions = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'avif',
];

/** 压缩包（仅展示图标，不支持内容预览） */
export const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];

/** PDF（pdfjs-dist 渲染） */
export const pdfExtensions = ['pdf'];

/** Word（docx-preview 渲染；旧版 .doc 二进制格式无法解析，回退下载） */
export const wordExtensions = ['docx'];

/** 表格（SheetJS 解析，xls/xlsx/csv） */
export const excelExtensions = ['xls', 'xlsx', 'csv'];

/** Markdown（markdown-it 渲染） */
export const markdownExtensions = ['md', 'markdown'];

/** 纯文本 */
export const textExtensions = ['txt'];

/** 代码文件（highlight.js 语法高亮） */
export const codeExtensions = [
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'json',
  'xml',
  'yaml',
  'yml',
  'go',
  'py',
  'java',
  'cpp',
  'c',
  'rs',
  'rb',
  'php',
];

/** HTML（sandbox iframe 隔离渲染，防 XSS） */
export const htmlExtensions = ['html', 'htm'];

/**
 * PPT：浏览器无内建渲染器，不支持内嵌预览。
 * 卡片点击时新标签打开（浏览器自动触发下载），独立预览页回退下载引导。
 */
export const pptExtensions = ['ppt', 'pptx'];

/**
 * 支持内嵌预览的扩展名集合。
 * ppt/ofd/dxf/旧版 doc 不在其列：这些格式一律回退下载。
 */
export const supportedExtensions = [
  ...pdfExtensions,
  ...wordExtensions,
  ...excelExtensions,
  ...markdownExtensions,
  ...textExtensions,
  ...codeExtensions,
  ...htmlExtensions,
  ...imageExtensions,
  ...videoExtensions,
  ...audioExtensions,
];

export const getFileExtension = (path: string): string => {
  return path.split('.').pop()?.toLowerCase() || '';
};

export const isImage = (path: string): boolean => {
  const ext = getFileExtension(path);
  return imageExtensions.includes(ext);
};

export const isVideo = (path: string): boolean => {
  const ext = getFileExtension(path);
  return videoExtensions.includes(ext);
};

export const isAudio = (path: string): boolean => {
  const ext = getFileExtension(path);
  return audioExtensions.includes(ext);
};

/** 视频扩展名对应的 MIME 类型，供播放器声明 source type（未知回退 video/mp4） */
const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
};

export const getVideoMimeType = (path: string): string => {
  const ext = getFileExtension(path);
  return VIDEO_MIME_TYPES[ext] || 'video/mp4';
};

export const isSupported = (path: string): boolean => {
  const ext = getFileExtension(path);
  return supportedExtensions.includes(ext);
};

export const isArchive = (path: string): boolean => {
  const ext = getFileExtension(path);
  return archiveExtensions.includes(ext);
};

/** PPT 类文件：内嵌预览不支持，走新标签打开（浏览器触发下载） */
export const isPptExternal = (path: string): boolean => {
  const ext = getFileExtension(path);
  return pptExtensions.includes(ext);
};
