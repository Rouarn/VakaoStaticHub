import { getApiBaseUrl } from '@/utils/file-url';

/** 一言失败类型：用于把「未配置」「上游错误」与「网络不可达」明确区分开 */
export type HitokotoErrorKind =
  'disabled' | 'upstream' | 'network' | 'format' | 'http';

/** 一言请求失败，kind 用于选择页面上的错误标题 */
export class HitokotoError extends Error {
  readonly kind: HitokotoErrorKind;

  constructor(kind: HitokotoErrorKind, message: string) {
    super(message);
    this.name = 'HitokotoError';
    this.kind = kind;
  }
}

/** 一言接口返回结构（字段均来自一言服务，可能缺省） */
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

/** 运行时配置接口：一言地址只存在于服务端，这里取回页面直连地址 */
const RUNTIME_CONFIG_PATH = '/runtime-config';

interface RuntimeConfig {
  hitokotoUrl: string;
}

/** 一言服务的错误响应体，只有 message 需要展示 */
interface QuoteErrorBody {
  message?: unknown;
}

/** 去掉结尾斜杠，避免拼出 `//?c=a` 这类地址 */
function trimTrailingSlash(url: string) {
  return url.replace(/\/+$/, '');
}

/**
 * 读取一言直连地址。
 *
 * 地址由服务端环境变量 HITOKOTO_API_URL 提供，前端通过运行时配置接口获取；
 * 为空表示部署方关闭了一言，页面应提示「未配置」而不是继续拼地址。
 */
export async function loadHitokotoBaseUrl(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${RUNTIME_CONFIG_PATH}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError';
    throw new HitokotoError(
      'network',
      timeout
        ? '读取一言地址超时：10 秒内未收到本服务响应'
        : '网络连接失败：无法读取一言地址配置',
    );
  }
  if (!res.ok) {
    throw new HitokotoError('http', `读取一言地址失败（HTTP ${res.status}）`);
  }
  let body: { data?: RuntimeConfig | null };
  try {
    body = (await res.json()) as { data?: RuntimeConfig | null };
  } catch {
    throw new HitokotoError('format', '一言地址配置不是合法 JSON');
  }
  const url =
    typeof body.data?.hitokotoUrl === 'string'
      ? trimTrailingSlash(body.data.hitokotoUrl.trim())
      : '';
  if (!url) {
    throw new HitokotoError(
      'disabled',
      '一言地址未配置：服务端 HITOKOTO_API_URL 为空',
    );
  }
  return url;
}

/** 一言服务的请求地址（用于展示与复制），由页面直接发起 */
export function buildHitokotoUrl(baseUrl: string, req: HitokotoRequest) {
  const query = new URLSearchParams();
  if (req.categories.length > 0) query.set('c', req.categories.join('|'));
  if (req.encode === 'text') query.set('encode', 'text');
  const qs = query.toString();
  return `${trimTrailingSlash(baseUrl)}${qs ? `?${qs}` : ''}`;
}

/**
 * 直连一言服务。响应不经过本服务的统一信封：
 * JSON 模式是一言记录本身，text 模式是纯文本，因此用 fetch 读取原文。
 */
export async function requestHitokoto(baseUrl: string, req: HitokotoRequest) {
  const url = buildHitokotoUrl(baseUrl, req);
  let res: Response;
  try {
    // AbortSignal.timeout 避免一言服务挂起时页面一直转圈
    res = await fetch(url, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError';
    throw new HitokotoError(
      'network',
      timeout
        ? '一言请求超时：15 秒内未收到一言服务响应'
        : '网络连接失败：无法访问一言服务（请确认地址可达、跨域已放行）',
    );
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new HitokotoError('network', '网络连接中断：读取一言响应失败');
  }
  if (!res.ok) {
    // 一言服务的错误体形如 { status, message, data, ts }，优先展示其文案
    let serverMessage = '';
    try {
      const body = JSON.parse(text) as QuoteErrorBody;
      if (typeof body.message === 'string') serverMessage = body.message;
    } catch {
      // 错误页可能不是 JSON，忽略解析失败
    }
    throw new HitokotoError(
      'upstream',
      serverMessage || `一言服务请求失败（HTTP ${res.status}）`,
    );
  }
  if (req.encode === 'text')
    return { url, text, data: null as HitokotoResult | null };
  let data: HitokotoResult | null;
  try {
    data = JSON.parse(text) as HitokotoResult | null;
  } catch {
    throw new HitokotoError(
      'format',
      '一言响应不是合法 JSON（一言服务可能返回了错误页）',
    );
  }
  if (!data || typeof data.hitokoto !== 'string') {
    throw new HitokotoError('format', '一言响应缺少 hitokoto 字段');
  }
  return { url, text, data };
}
