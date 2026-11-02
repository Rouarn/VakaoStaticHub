import type { Router } from 'vue-router';
import { useAuthStore } from '@/stores/modules/auth';

/**
 * 全局路由守卫
 *
 * - meta.public 路由直接放行（登录 / 分享访问 / 独立预览页）
 * - 其余路由要求登录，未登录跳 /login 并携带 redirect 回跳参数
 * - 已登录访问 /login 时直接进入文件库
 * - 同步 document.title
 */
export function setupGuard(router: Router) {
  router.beforeEach((to) => {
    const authStore = useAuthStore();

    if (to.meta.public) {
      if (to.name === 'login' && authStore.isLoggedIn) {
        return { name: 'files' };
      }
      return true;
    }

    if (!authStore.isLoggedIn) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
    return true;
  });

  router.afterEach((to) => {
    document.title = to.meta.title
      ? `${to.meta.title} · 静态资源管理`
      : '静态资源管理';
  });
}
