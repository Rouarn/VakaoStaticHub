import { defineStore } from 'pinia';
import type { RootIndexStatus } from '@vakao/shared';
import { getRootIndexStatus } from '@/api/roots';

const POLL_INTERVAL = 2000;

/**
 * 根目录索引状态：页面打开先查一次，有 running 时每 2 秒轮询，
 * 全部结束后自动停止。状态只存在服务端内存中，这里不持久化。
 */
export const useIndexStatusStore = defineStore('indexStatus', {
  state: () => ({
    roots: [] as RootIndexStatus[],
    timer: null as number | null,
  }),
  getters: {
    statusOf:
      (state) =>
      (rootId: string): RootIndexStatus | null =>
        state.roots.find((item) => item.rootId === rootId) ?? null,
    anyRunning: (state) => state.roots.some((item) => item.state === 'running'),
  },
  actions: {
    async refresh() {
      try {
        this.roots = await getRootIndexStatus();
      } catch {
        // 状态查询失败不影响文件库本身，下一轮再试
      }
      if (!this.anyRunning) this.stop();
    },
    /** 查询一次；若有根目录在扫描则继续轮询 */
    async start() {
      await this.refresh();
      if (this.anyRunning) this.schedule();
    },
    schedule() {
      if (this.timer !== null) return;
      this.timer = window.setInterval(() => {
        void this.refresh();
      }, POLL_INTERVAL);
    },
    stop() {
      if (this.timer === null) return;
      window.clearInterval(this.timer);
      this.timer = null;
    },
  },
});
