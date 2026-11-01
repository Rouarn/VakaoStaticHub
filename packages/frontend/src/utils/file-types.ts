export const videoExtensions = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'ogv'];

export const supportedExtensions = [
  // PDF
  'pdf',
  // Word
  'doc',
  'docx',
  // Excel
  'xls',
  'xlsx',
  // CSV
  'csv',
  // PPT
  'ppt',
  'pptx',
  // Markdown
  'md',
  'markdown',
  // TXT
  'txt',
  // HTML
  'html',
  'htm',
  // OFD
  'ofd',
  // DXF
  'dxf',
  // Images
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'avif',
  // Video
  ...videoExtensions,
  // Audio
  'mp3',
  'wav',
  'ogg',
  // Code
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

export const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];

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
