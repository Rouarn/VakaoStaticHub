/**
 * `name` 参数归一（?file= 与 ?code= 共用一套语义）
 *
 * 三种形态：
 * - 空 / 只有点：返回 null，由调用方使用兜底名（短链最后一段或 file-<code>）
 * - 只给扩展名（.mp4、.MP3、.tar.gz）：展示名沿用兜底名，类型按该扩展名
 * - 完整文件名：展示名与类型都用它（去掉路径分隔符，防止拼接路径）
 */
export interface NameHint {
  /** 界面展示名 */
  display: string;
  /** 供预览器解析的虚拟文件名（可能带兜底名 + 扩展名） */
  previewName: string;
}

const EXTENSION_ONLY = /^\.[^\\/\s]+$/;
const ONLY_DOTS = /^\.+$/;

export function normalizeNameHint(
  raw: unknown,
  fallback: string,
): NameHint | null {
  const list: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [raw];
  const first: unknown = list[0];
  const value = typeof first === 'string' ? first.trim() : '';
  if (!value || ONLY_DOTS.test(value)) return null;
  if (EXTENSION_ONLY.test(value)) {
    return {
      display: fallback,
      previewName: `${fallback}${value.toLowerCase()}`,
    };
  }
  const base = value.split(/[\\/]/).pop() ?? '';
  return base ? { display: base, previewName: base } : null;
}
