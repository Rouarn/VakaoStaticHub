import { createClient, RequestError } from '@vakao-ui/axios';
import { useAuthStore } from '@/stores/modules/auth';
import router from '@/router';
import { getApiBaseUrl } from '@/utils/file-url';

/**
 * 全局请求客户端（基于 @vakao-ui/axios）
 *
 * - 服务端所有 JSON 响应统一为 { code, message, data }，请求库默认契约
 *   （successCode=200、unwrap=body.data）直接解包真实信封
 * - 自动注入 Authorization: Bearer <token>
 * - 401：清空登录态并跳转登录页（保留 redirect 便于登录后回跳）
 */
export const http = createClient({
  baseURL: getApiBaseUrl(),
  timeout: 10000,
  auth: {
    getToken: () => {
      const authStore = useAuthStore();
      return authStore.isLoggedIn
        ? `Bearer ${authStore.accessToken}`
        : undefined;
    },
  },
  onError: (error) => {
    // 修改密码时「原密码错误」后端返回 401，属于表单校验失败，
    // 不能按登录态失效处理（否则会把用户踢回登录页）。
    const requestUrl = error.response?.config?.url ?? '';
    const isPasswordChange = requestUrl.includes('/auth/password');
    if (error.type === 'http' && error.code === 401 && !isPasswordChange) {
      const authStore = useAuthStore();
      authStore.clearAuth();
      if (router.currentRoute.value.name !== 'login') {
        void router.push({
          name: 'login',
          query: { redirect: router.currentRoute.value.fullPath },
        });
      }
    }
  },
});

/**
 * 公开接口客户端（分享访问 / 一言）
 *
 * 不能复用 http：后者对任意 401 都会清空登录态并跳转登录页，
 * 而分享页的「密码错误」正是 401，公开页会被误跳走。
 */
export const publicHttp = createClient({
  baseURL: getApiBaseUrl(),
  timeout: 15000,
});

/** 服务端错误信封：{ code: HTTP 状态码, message, data: null } */
interface ErrorEnvelope {
  message?: string | string[];
}

function extractEnvelopeMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const envelope = body as ErrorEnvelope;
  const raw = envelope.message;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .join('；');
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

export { extractEnvelopeMessage };

const TRANSPORT_MESSAGE: Partial<Record<RequestError['type'], string>> = {
  timeout: '请求超时，请稍后重试',
  network: '网络连接异常，请检查网络',
  cancel: '请求已取消',
};

/** 从请求错误中提取用户可见文案 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof RequestError)) return fallback;
  const transport = TRANSPORT_MESSAGE[error.type];
  if (transport) return transport;
  return extractEnvelopeMessage(error.response?.data) || fallback;
}
