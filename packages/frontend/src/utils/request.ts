import { createClient, RequestError } from '@vakao-ui/axios';
import { getApiBaseUrl } from '@/utils/env';
import { useAuthStore } from '@/stores/modules/auth';
import router from '@/router';

/**
 * 全局请求客户端（基于 @vakao-ui/axios）
 *
 * - 默认适配后端 { code, message, data } 响应信封，成功直接返回业务数据
 * - 自动注入 Authorization；401 时清除登录态并跳转登录页
 * - 库不内置错误文案：失败时完整错误信息在 RequestError 上（原始信封取 error.response.data），
 *   调用方统一通过 getErrorMessage 提取用户可见文案
 */
export const request = createClient({
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
    // 已在登录页时不重复跳转，并保留 redirect 便于登录后回跳
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

/** 从错误响应信封提取文案：字符串数组逐条去空白后拼接 */
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

/** 传输层错误（无响应体）按错误类型映射的项目文案 */
const TRANSPORT_MESSAGE: Partial<Record<RequestError['type'], string>> = {
  timeout: '请求超时，请稍后重试',
  network: '网络连接异常，请检查网络',
  cancel: '请求已取消',
};

/**
 * 提取请求错误中用户可见的文案
 *
 * - timeout / network / cancel：按错误类型映射固定文案
 * - business / http：从 error.response.data 的后端信封提取 message（支持字符串数组）
 * - 非请求错误，或信封中没有可用文案时：返回调用方提供的业务兜底文案
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof RequestError)) return fallback;
  const transport = TRANSPORT_MESSAGE[error.type];
  if (transport) return transport;
  return extractEnvelopeMessage(error.response?.data) || fallback;
}
