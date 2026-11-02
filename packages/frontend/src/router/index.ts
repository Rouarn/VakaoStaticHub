import { createRouter, createWebHistory } from 'vue-router';
import { routes } from './routes';
import { setupGuard } from './guard';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

setupGuard(router);

export default router;
