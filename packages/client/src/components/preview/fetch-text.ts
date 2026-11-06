/**
 * 预览组件共用的文本拉取：限制体积并给出可读错误
 * 用于文本 / 代码 / Markdown / HTML 预览，避免超大文件撑爆内存
 */
export const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024;

export async function fetchText(
  url: string,
  maxBytes = TEXT_PREVIEW_LIMIT,
): Promise<{ text: string; truncated: boolean }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
  const declared = Number(resp.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new Error(`文件过大（${declared} 字节），已跳过文本预览`);
  }
  const text = await resp.text();
  if (text.length > maxBytes) {
    return { text: text.slice(0, maxBytes), truncated: true };
  }
  return { text, truncated: false };
}
