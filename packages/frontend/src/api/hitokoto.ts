import { getApiBaseUrl } from '@/utils/http';

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
  const res = await fetch(url, { headers: { Accept: '*/*' } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      res.status === 502
        ? '一言上游暂不可用（后端代理返回 502）'
        : res.status === 404
          ? '一言代理未启用：后端未配置 HITOKOTO_API_URL（或未匹配 /static/hitokoto）'
          : `一言请求失败（HTTP ${res.status}）`,
    );
  }
  if (req.encode === 'text')
    return { url, text, data: null as HitokotoResult | null };
  let data: HitokotoResult;
  try {
    data = JSON.parse(text) as HitokotoResult;
  } catch {
    throw new Error('一言响应不是合法 JSON（上游可能返回了错误页）');
  }
  if (typeof data.hitokoto !== 'string') {
    throw new Error('一言响应缺少 hitokoto 字段');
  }
  return { url, text, data };
}
