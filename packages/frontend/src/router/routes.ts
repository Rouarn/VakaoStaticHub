import { RouterView } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { h } from 'vue';
import type { Component } from 'vue';
import {
  FolderOpenOutline,
  ShareSocialOutline,
  RocketOutline,
  FunnelOutline,
  PieChartOutline,
  CopyOutline,
  PeopleOutline,
  DocumentTextOutline,
  SpeedometerOutline,
  ConstructOutline,
  CodeSlashOutline,
} from '@vicons/ionicons5';

/**
 * 路由表（新架构功能清单的唯一落点）
 *
 * - meta.public: true 为公开路由（登录 / 分享访问 / 独立预览页），其余需鉴权
 * - meta.sidebar: true 的项出现在 System Sidebar（纯图标 + Tooltip），icon 为元信息
 * - 未实现页面统一使用 placeholder 视图，路由与目录结构先行固化
 */

declare module 'vue-router' {
  interface RouteMeta {
    /** 公开路由，免鉴权 */
    public?: boolean;
    /** 页面标题（面包屑/文档标题） */
    title?: string;
    /** 是否出现在 System Sidebar */
    sidebar?: boolean;
    /** System Sidebar 图标 */
    icon?: Component;
    /**
     * 是否为资源管理路由：只有该路由会在布局中渲染第二个分类面板。
     * 单一开关由布局层读取，视图内不再各自判断。
     */
    categoryPanel?: boolean;
  }
}

/** 鉴权区子路由（挂在 DefaultLayout 下） */
const protectedChildren: RouteRecordRaw[] = [
  {
    path: 'files',
    name: 'files',
    component: () => import('@/views/files/index.vue'),
    meta: {
      title: '文件库',
      sidebar: true,
      icon: FolderOpenOutline,
      categoryPanel: true,
    },
  },
  {
    path: 'shares',
    name: 'shares',
    component: () => import('@/views/shares/index.vue'),
    meta: { title: '分享管理', sidebar: true, icon: ShareSocialOutline },
  },
  {
    path: 'app-update',
    name: 'app-update',
    component: () => import('@/views/app-update/index.vue'),
    meta: { title: 'APP 版本', sidebar: true, icon: RocketOutline },
  },
  {
    path: 'app-update/stats',
    name: 'app-update-stats',
    component: () => import('@/views/app-update/stats.vue'),
    meta: { title: '升级漏斗', sidebar: true, icon: FunnelOutline },
  },
  {
    path: 'storage-stats',
    name: 'storage-stats',
    component: () => import('@/views/storage-stats/index.vue'),
    meta: { title: '存储统计', sidebar: true, icon: PieChartOutline },
  },
  {
    path: 'duplicate-files',
    name: 'duplicate-files',
    component: () => import('@/views/duplicate-files/index.vue'),
    meta: { title: '重复文件', sidebar: true, icon: CopyOutline },
  },
  {
    path: 'users',
    name: 'users',
    component: () => import('@/views/users/index.vue'),
    meta: { title: '用户管理', sidebar: true, icon: PeopleOutline },
  },
  {
    path: 'audit-logs',
    name: 'audit-logs',
    component: () => import('@/views/audit-logs/index.vue'),
    meta: { title: '审计日志', sidebar: true, icon: DocumentTextOutline },
  },
  {
    path: 'system-status',
    name: 'system-status',
    component: () => import('@/views/system-status/index.vue'),
    meta: { title: '系统状态', sidebar: true, icon: SpeedometerOutline },
  },
  {
    // 侧边栏入口（带子路由：占位图 / 一言）；默认进占位图，激活态按 /tools 前缀判定
    path: 'tools',
    name: 'tools',
    redirect: { name: 'tools-placeholder' },
    meta: { title: '实用工具', sidebar: true, icon: ConstructOutline },
    // 组件化父路由：仅渲染子路由出口，侧边栏据此展开二级菜单
    component: { render: () => h(RouterView) },
    children: [
      {
        path: 'placeholder',
        name: 'tools-placeholder',
        component: () => import('@/views/tools/placeholder/index.vue'),
        meta: { title: '占位图生成' },
      },
      {
        path: 'hitokoto',
        name: 'tools-hitokoto',
        component: () => import('@/views/tools/hitokoto/index.vue'),
        meta: { title: '一言' },
      },
    ],
  },
  {
    path: 'api-docs',
    name: 'api-docs',
    component: () => import('@/views/api-docs/index.vue'),
    meta: { title: 'API 文档', sidebar: true, icon: CodeSlashOutline },
  },
];

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/share/:token',
    name: 'share-access',
    component: () => import('@/views/share-access/index.vue'),
    meta: { public: true, title: '分享访问' },
  },
  {
    path: '/file-preview',
    name: 'file-preview',
    component: () => import('@/views/file-preview/index.vue'),
    meta: { public: true, title: '文件预览' },
  },
  {
    path: '/',
    component: () => import('@/layouts/default-layout.vue'),
    children: [{ path: '', redirect: { name: 'files' } }, ...protectedChildren],
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'files' } },
];
