import { defineStore } from 'pinia';
import { RequestError } from '@vakao-ui/axios';
import type { ResourceRoot } from '@vakao/shared';
import { listRoots } from '@/api/roots';
import { getUsageStats, listCategories, renameCategory } from '@/api/files';
import { getErrorMessage } from '@/utils/http';

/**
 * 资源分类 store（Category Panel 的数据源）
 *
 * - roots / categories 均来自后端真实接口
 * - 计数来自 GET /files/stats/usage 的分类聚合（后端 categories 接口只返回目录名）
 * - 后端没有「新建/删除空分类」接口：分类目录由上传文件时隐式创建，
 *   删除分类需先清空文件且后端未提供 rmdir 接口 —— store 如实抛错，UI 不做假成功
 */

export interface CategoryEntry {
  name: string;
  fileCount: number;
  totalSize: number;
}

/** 分类条目带上所属根目录，便于按根目录过滤 */
interface RootCategoryEntry extends CategoryEntry {
  rootId: string;
}

/** 同 key 的重复请求在 @vakao-ui/axios 内会被后发请求取消，因此按 rootId 去重 */
const categoryInflight = new Map<string, Promise<void>>();
let rootsInflight: Promise<void> | null = null;

/** 请求取消（被同 key 请求取代）不是错误，不应污染错误态 */
const isCanceled = (e: unknown) =>
  e instanceof RequestError && e.type === 'cancel';

export const useCategoryStore = defineStore('category', {
  state: () => ({
    roots: [] as ResourceRoot[],
    /** 全部分类条目（含 rootId） */
    entries: [] as RootCategoryEntry[],
    activeCategory: null as string | null,
    loading: false,
    error: '',
    /** 面板查询计数时的静默刷新标记 */
    refreshing: false,
  }),
  getters: {
    categoriesOf:
      (state) =>
      (rootId: string): CategoryEntry[] =>
        state.entries.filter((entry) => entry.rootId === rootId),
    rootName: (state) => (rootId: string) =>
      state.roots.find((r) => r.id === rootId)?.name ?? rootId,
  },
  actions: {
    async loadRoots() {
      if (rootsInflight) return rootsInflight;
      this.error = '';
      const task = (async () => {
        try {
          this.roots = await listRoots();
        } catch (e) {
          if (!isCanceled(e)) this.error = getErrorMessage(e, '根目录加载失败');
        }
      })();
      rootsInflight = task;
      try {
        await task;
      } finally {
        rootsInflight = null;
      }
    },

    /** 拉取某个根目录的分类列表 + 计数（并发调用复用同一请求） */
    async loadCategories(rootId: string, opts: { silent?: boolean } = {}) {
      const existing = categoryInflight.get(rootId);
      if (existing) return existing;

      if (!opts.silent) {
        this.loading = true;
        this.error = '';
      } else {
        this.refreshing = true;
      }
      const task = (async () => {
        try {
          const [names, usage] = await Promise.all([
            listCategories(rootId),
            // 计数失败不应阻断分类列表展示
            getUsageStats().catch(() => null),
          ]);
          const rootUsage = usage?.roots.find((r) => r.rootId === rootId);
          const counts = new Map(
            (rootUsage?.categories ?? []).map((c) => [c.category, c]),
          );
          this.entries = [
            ...this.entries.filter((entry) => entry.rootId !== rootId),
            ...names.map((name) => ({
              rootId,
              name,
              fileCount: counts.get(name)?.fileCount ?? 0,
              totalSize: counts.get(name)?.totalSize ?? 0,
            })),
          ];
        } catch (e) {
          if (!isCanceled(e)) {
            this.error = getErrorMessage(e, '分类加载失败');
            this.entries = this.entries.filter(
              (entry) => entry.rootId !== rootId,
            );
          }
        } finally {
          this.loading = false;
          this.refreshing = false;
        }
      })();
      categoryInflight.set(rootId, task);
      try {
        await task;
      } finally {
        categoryInflight.delete(rootId);
      }
    },

    setActiveCategory(name: string | null) {
      this.activeCategory = name;
    },

    async rename(rootId: string, category: string, newCategory: string) {
      await renameCategory(rootId, category, newCategory);
      await this.loadCategories(rootId, { silent: true });
      if (this.activeCategory === category) this.activeCategory = newCategory;
    },

    /**
     * 删除分类：后端没有独立接口。
     * 分类目录随上传隐式创建，且服务端未提供删除空目录的 API，
     * 因此这里明确拒绝并给出可执行路径，而不是伪造成功。
     */
    delete(): never {
      throw new Error(
        '后端未提供删除分类接口：分类目录随上传隐式创建，删除需先清空该分类文件且服务端未提供删除空目录 API，请在服务器侧处理。',
      );
    },
  },
});
