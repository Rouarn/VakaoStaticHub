import { createClient, RequestError } from '@vakao-ui/axios';
import { getApiBaseUrl } from '@/utils/env';
import { useAuthStore } from '@/stores/modules/auth';
import router from '@/router';

/**
 * 全局请求客户端（基于 @vakao-ui/axios）
 *
 * - 默认适配后端 { code, message, data } 响应信封，成功直接返回业务数据
 * - 自动注入 Authorization；401 时清除登录态并跳转登录页
 * - 失败统一抛出 RequestError，调用方可用 getErrorMessage 提取用户可见文案
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

/** 提取请求错误中用户可见的文案；非请求错误返回兜底文案 */
export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof RequestError ? error.message : fallback;
}
