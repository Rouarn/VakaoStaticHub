import { defineStore } from 'pinia';
import { getSidebarCounts } from '@/api/metrics';

/**
 * 侧栏计数（文件 / 分享）
 *
 * 只服务导航徽标，数据来自轻量的 GET /metrics/sidebar；
 * 请求失败时静默保留旧值，不影响导航本身。
 */
export const useOverviewStore = defineStore('overview', {
  state: () => ({
    files: 0,
    shares: 0,
    loading: false,
  }),
  actions: {
    async load() {
      if (this.loading) return;
      this.loading = true;
      try {
        const counts = await getSidebarCounts();
        this.files = counts.files;
        this.shares = counts.shares;
      } catch {
        // 徽标失败不影响导航
      } finally {
        this.loading = false;
      }
    },
  },
});
