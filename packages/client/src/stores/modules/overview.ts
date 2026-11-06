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
    /**
     * 在途请求期间又收到的刷新请求：结束后补跑一次。
     * 直接丢弃会让「变更前发出、变更后落地」的旧响应覆盖新值。
     */
    pending: false,
  }),
  actions: {
    /** 导航触发的刷新（路由变化 / 首次挂载） */
    async load() {
      if (this.loading) {
        this.pending = true;
        return;
      }
      this.loading = true;
      try {
        const counts = await getSidebarCounts();
        this.files = counts.files;
        this.shares = counts.shares;
      } catch {
        // 徽标失败不影响导航
      } finally {
        this.loading = false;
        if (this.pending) {
          this.pending = false;
          void this.load();
        }
      }
    },
    /** 分享等写操作成功后的强制刷新，与 load 共用同一套合并补跑逻辑 */
    async refresh() {
      await this.load();
    },
  },
});
