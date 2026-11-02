import { defineStore } from 'pinia';
import type { ResourceRoot } from '@vakao/shared';

/**
 * 资源分类状态（双轨制中的 Category Panel 数据源）
 *
 * TODO(下一轮)：根目录列表与分类列表改为拉取后端接口
 * （GET /files/roots、GET /files/:rootId/categories），
 * 新建/重命名/删除分类对接 PATCH /files/:rootId/categories/:category。
 * 本轮仅提供与接口结构一致的本地 mock，保证面板交互链路完整。
 */
export interface CategoryItem {
  name: string;
  /** 文件数（mock） */
  count: number;
}

const MOCK_ROOTS: ResourceRoot[] = [
  { id: 'default', name: '默认存储', path: 'storage' },
  { id: 'software-update', name: '软件更新', path: 'software-update' },
];

const MOCK_CATEGORIES: Record<string, CategoryItem[]> = {
  default: [
    { name: 'TemporaryFile', count: 128 },
    { name: '设计稿', count: 46 },
    { name: '文档资料', count: 73 },
    { name: '图片素材', count: 315 },
    { name: '音视频', count: 24 },
    { name: '归档备份', count: 12 },
    { name: '字体资源', count: 18 },
    { name: '图标库', count: 56 },
    { name: '营销物料', count: 89 },
    { name: '产品截图', count: 142 },
    { name: '临时分享', count: 31 },
    { name: '历史版本', count: 8 },
  ],
  'software-update': [
    { name: 'xiaolv', count: 9 },
    { name: 'xiaolan', count: 5 },
  ],
};

export const useCategoryStore = defineStore('category', {
  state: () => ({
    roots: MOCK_ROOTS,
    categoriesByRoot: MOCK_CATEGORIES,
    activeCategory: null as string | null,
  }),
  getters: {
    categoriesOf:
      (state) =>
      (rootId: string): CategoryItem[] =>
        state.categoriesByRoot[rootId] ?? [],
  },
  actions: {
    setActiveCategory(name: string | null) {
      this.activeCategory = name;
    },
    /** mock 新建分类：下一轮替换为后端接口调用 */
    addCategory(rootId: string, name: string) {
      const list = this.categoriesByRoot[rootId] ?? [];
      if (list.some((item) => item.name === name)) return false;
      list.push({ name, count: 0 });
      this.categoriesByRoot[rootId] = list;
      return true;
    },
  },
});
