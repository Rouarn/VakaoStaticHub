import { defineStore } from 'pinia';

/**
 * 应用级状态：主题偏好 + 当前资源根目录
 *
 * 主题：isDark 持久化到 localStorage，App.vue 中 watch 同步到
 * documentElement 的 `dark` class（驱动 UnoCSS dark: 变体），
 * 同时决定 NConfigProvider 使用 light/dark theme overrides。
 */
export const useAppStore = defineStore('app', {
  state: () => ({
    isDark: false,
    /** 当前资源根目录 id（多根目录切换，分类面板与文件库共用） */
    activeRootId: 'default',
    /** 系统图标栏是否展开（收起 72px 纯图标 / 展开 208px 图标 + 文字） */
    sidebarExpanded: false,
  }),
  actions: {
    toggleDark() {
      this.isDark = !this.isDark;
    },
    toggleSidebar() {
      this.sidebarExpanded = !this.sidebarExpanded;
    },
    /** 把主题偏好同步到 <html> 的 class（启动与切换时各调一次） */
    applyDarkClass() {
      document.documentElement.classList.toggle('dark', this.isDark);
    },
    setActiveRoot(rootId: string) {
      this.activeRootId = rootId;
    },
  },
  persist: true,
});
