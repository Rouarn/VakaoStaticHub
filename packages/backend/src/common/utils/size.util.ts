/**
 * 解析文件大小字符串为字节数
 * 支持格式：'10mb', '1kb', '1gb', '1024' (默认单位为字节)
 * @param size 文件大小字符串或数字
 * @returns 字节数
 */
export function parseSize(size: string | number | undefined): number {
  if (typeof size === 'number') return size;
  if (!size) return 0;

  const match = String(size).match(/^(\d+(\.\d+)?)\s*([a-z]+)?$/i);
  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = (match[3] || 'b').toLowerCase();

  switch (unit) {
    case 'kb':
      return num * 1024;
    case 'mb':
      return num * 1024 * 1024;
    case 'gb':
      return num * 1024 * 1024 * 1024;
    case 'tb':
      return num * 1024 * 1024 * 1024 * 1024;
    case 'b':
    default:
      return num;
  }
}
