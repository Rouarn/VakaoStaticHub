import { getApiBaseUrl } from '@/utils/file-url';

/** 一言失败类型：用于把「代理未启用」与「网络不可达」明确区分开 */
export type HitokotoErrorKind =
  'proxy-disabled' | 'upstream' | 'network' | 'format' | 'http';

export class HitokotoError extends Error {
  readonly kind: HitokotoErrorKind;

  constructor(kind: HitokotoErrorKind, message: string) {
    super(message);
    this.name = 'HitokotoError';
    this.kind = kind;
  }
}

export interface HitokotoResult {
  id?: number;
  hitokoto: string;
  type?: string;
  from?: string;
  from_who?: string | null;
  uuid?: string;
}

export interface HitokotoRequest {
  /** 分类：a 动画 b 漫画 c 游戏 d 文学 e 原创 f 来自网络 g 其他 h 影视 i 诗词 j 网易云 k 哲学 l 抖机灵 */
  categories: string[];
  /** 返回编码：json / text */
  encode: 'json' | 'text';
}

/** 请求地址（用于展示与复制） */
export function buildHitokotoUrl(req: HitokotoRequest) {
  const query = new URLSearchParams();
  if (req.categories.length > 0) query.set('c', req.categories.join('|'));
  if (req.encode === 'text') query.set('encode', 'text');
  const qs = query.toString();
  return `${getApiBaseUrl()}/hitokoto${qs ? `?${qs}` : ''}`;
}

/**
 * 一言是后端反向代理，原样透传上游响应，不走 {code,message,data} 信封，
 * 因此直接用 fetch 读取文本，不经过统一请求客户端。
 */
export async function requestHitokoto(req: HitokotoRequest) {
  const url = buildHitokotoUrl(req);
  let res: Response;
  try {
    // AbortSignal.timeout 避免后端/上游挂起时页面一直转圈
    res = await fetch(url, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError';
    throw new HitokotoError(
      'network',
      timeout
        ? '一言请求超时：15 秒内未收到后端响应'
        : '网络连接失败：无法访问后端（请确认服务已启动、网络连通）',
    );
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new HitokotoError('network', '网络连接中断：读取一言响应失败');
  }
  if (!res.ok) {
    // 后端 503 会带 { code: 'HITOKOTO_PROXY_DISABLED', message }，
    // 优先展示服务端文案（明确说明“代理未启用”）
    let serverMessage = '';
    try {
      const body = JSON.parse(text) as { message?: unknown };
      if (typeof body.message === 'string') serverMessage = body.message;
    } catch {
      // 上游错误页可能不是 JSON，忽略解析失败
    }
    throw new HitokotoError(
      res.status === 503 ? 'proxy-disabled' : 'upstream',
      res.status === 503
        ? serverMessage || '一言代理未启用（后端返回 503）'
        : res.status === 502
          ? '一言上游暂不可用（后端代理返回 502）'
          : res.status === 404
            ? '一言代理未启用：后端未匹配 /static/hitokoto 路由（返回 404）'
            : `一言请求失败（HTTP ${res.status}）`,
    );
  }
  if (req.encode === 'text')
    return { url, text, data: null as HitokotoResult | null };
  let data: HitokotoResult;
  try {
    data = JSON.parse(text) as HitokotoResult;
  } catch {
    throw new HitokotoError(
      'format',
      '一言响应不是合法 JSON（上游可能返回了错误页）',
    );
  }
  if (typeof data.hitokoto !== 'string') {
    throw new HitokotoError('format', '一言响应缺少 hitokoto 字段');
  }
  return { url, text, data };
}
