/**
 * 文本文件解码：优先 UTF-8（fatal 严格模式），失败回退 GBK。
 * 国内遗留的 txt/csv/md 文件常为 GBK 编码，直接 UTF-8 解码会乱码。
 * 供 text / markdown / xlsx(csv) 预览共用。
 */
export const decodeTextBuffer = (buffer: ArrayBuffer): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gbk').decode(buffer);
  }
};

/** fetch 文本文件并按 UTF-8/GBK 自动解码 */
export const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`文件加载失败（HTTP ${res.status}）`);
  }
  return decodeTextBuffer(await res.arrayBuffer());
};
