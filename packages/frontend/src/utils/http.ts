import { createClient, RequestError } from '@vakao-ui/axios';
import { useAuthStore } from '@/stores/modules/auth';
import router from '@/router';

/**
 * 获取 API 基础地址
 * VITE_API_BASE_URL 为 'origin' 或未配置时回退到当前页面 origin，统一加 /static 前缀
 */
export const getApiBaseUrl = () => {
  const envBaseURL = import.meta.env.VITE_API_BASE_URL;
  const base = envBaseURL === 'origin' ? window.location.origin : envBaseURL;
  return `${base ?? ''}/static`;
};

/**
 * 全局请求客户端（基于 @vakao-ui/axios）
 *
 * - 适配后端 { code, message, data } 响应信封，成功解包 data
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
    if (error.type === 'http' && error.code === 401) {
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

/** 后端错误信封（见 HttpExceptionFilter）：message 可能是 class-validator 返回的字符串数组 */
interface ErrorEnvelope {
  message?: string | string[];
}

function extractEnvelopeMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const { message } = body as ErrorEnvelope;
  if (Array.isArray(message)) {
    return message
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .join('；');
  }
  return typeof message === 'string' ? message.trim() : '';
}

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
