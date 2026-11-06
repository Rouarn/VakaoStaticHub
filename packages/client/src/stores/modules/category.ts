import { defineStore } from 'pinia';
import { RequestError } from '@vakao-ui/axios';
import type { ResourceRoot } from '@vakao/shared';
import { useAppStore } from '@/stores/modules/app';
import { listRoots, createRoot, updateRoot, deleteRoot } from '@/api/roots';
import {
  getUsageStats,
  listCategories,
  renameCategory,
  createCategory,
  deleteCategory,
} from '@/api/files';
import { getErrorMessage } from '@/utils/http';

/**
 * 资源分类 store（Category Panel 的数据源）
 *
 * - roots / categories 均来自后端真实接口
 * - 计数来自 GET /files/stats/usage 的分类聚合（后端 categories 接口只返回目录名）
 * - 新建 / 删除走后端 POST/DELETE /files/:rootId/categories，删除非空分类需显式 recursive
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
    loading: false,
    error: '',
    /** 面板查询计数时的静默刷新标记 */
    refreshing: false,
  }),
  getters: {
    /** 当前分类的唯一数据源在 app store，与根目录一起持久化 */
    activeCategory: (): string | null => useAppStore().activeCategory,
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
      useAppStore().setActiveCategory(name);
    },

    /**
     * 恢复上次选择的分类（含所属根目录）。
     *
     * 根目录或分类已不存在时清掉记录并返回 false；接口为空或加载失败时
     * 同样返回 false，但保留记录（可能只是本次请求失败），由调用方安静
     * 回退到默认分类，不阻断页面。
     */
    async restoreSelection(): Promise<boolean> {
      const app = useAppStore();
      const saved = {
        rootId: app.activeRootId,
        category: app.activeCategory,
      };
      if (!saved.category) return false;

      if (!this.roots.some((root) => root.id === saved.rootId)) {
        // 根目录加载成功且确实不存在才清理；空列表可能只是本次请求失败
        if (this.roots.length > 0) app.setActiveCategory(null);
        return false;
      }

      if (this.categoriesOf(saved.rootId).length === 0) {
        await this.loadCategories(saved.rootId);
      }
      const list = this.categoriesOf(saved.rootId);
      if (list.length === 0) return false;
      if (!list.some((entry) => entry.name === saved.category)) {
        app.setActiveCategory(null);
        return false;
      }
      app.setActiveRoot(saved.rootId);
      return true;
    },

    /** 新增资源根目录 */
    async addRoot(root: { id: string; name: string; path: string }) {
      await createRoot(root);
      await this.loadRoots();
    },

    /** 更新根目录名称或路径 */
    async editRoot(id: string, patch: { name?: string; path?: string }) {
      await updateRoot(id, patch);
      await this.loadRoots();
    },

    /** 删除根目录 */
    async removeRoot(id: string) {
      await deleteRoot(id);
      this.entries = this.entries.filter((entry) => entry.rootId !== id);
      await this.loadRoots();
    },

    async rename(rootId: string, category: string, newCategory: string) {
      await renameCategory(rootId, category, newCategory);
      await this.loadCategories(rootId, { silent: true });
      if (this.activeCategory === category) this.setActiveCategory(newCategory);
    },

    /** 新建空分类，成功后刷新列表 */
    async create(rootId: string, name: string) {
      await createCategory(rootId, name);
      await this.loadCategories(rootId, { silent: true });
      return name;
    },

    /** 删除分类（recursive 时连同文件一起删除），成功后刷新列表 */
    async delete(rootId: string, category: string, recursive = false) {
      const result = await deleteCategory(rootId, category, recursive);
      await this.loadCategories(rootId, { silent: true });
      if (this.activeCategory === category) this.setActiveCategory(null);
      return result;
    },
  },
});
