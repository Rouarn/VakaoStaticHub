/**
 * 路由实例。守卫在导出前注册，确保任何组件拿到 router 时鉴权逻辑已生效。
 * 使用 history 模式，服务端需把未知前端路径回退到 index.html。
 */
import { createRouter, createWebHistory } from 'vue-router';
import { routes } from './routes';
import { setupGuard } from './guard';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

setupGuard(router);

export default router;
