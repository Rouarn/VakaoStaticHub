import { getProfile } from '@/api/auth';
import { useAuthStore } from '@/stores/modules/auth';

/** 同一次会话内并发调用复用同一个请求 */
let pending: Promise<void> | null = null;

/**
 * 进入管理端时刷新一次当前用户资料。
 *
 * - 只在已登录时请求；401 由 utils/http 统一清理登录态
 * - 失败保持现有资料，不阻塞布局渲染
 */
export function refreshProfileOnce(): Promise<void> {
  const authStore = useAuthStore();
  if (!authStore.isLoggedIn) return Promise.resolve();
  if (pending) return pending;
  pending = getProfile()
    .then((user) => {
      authStore.setUser(user);
    })
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
  return pending;
}
