<script setup lang="ts">
import { computed, h } from 'vue';
import type { Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NTooltip, NIcon, NDropdown, NAvatar } from 'naive-ui';
import {
  MoonOutline,
  SunnyOutline,
  KeyOutline,
  LogOutOutline,
  CloudOutline,
} from '@vicons/ionicons5';
import { routes } from '@/router/routes';
import { useAppStore } from '@/stores/modules/app';
import { useAuthStore } from '@/stores/modules/auth';

/**
 * System Sidebar（72px 固定图标栏）
 *
 * 只放系统级功能入口（来自路由表 meta.sidebar），纯图标 + Hover Tooltip；
 * 底部为主题切换与当前用户菜单。用户动态资源分类在 Category Panel。
 */
const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();

interface NavItem {
  name: string;
  title: string;
  icon?: Component;
}

/** 从路由表提取侧边栏项（单一来源，避免菜单与路由漂移） */
const navItems = computed<NavItem[]>(() => {
  const root = routes.find((r) => r.path === '/');
  const children = root?.children ?? [];
  return children
    .filter((r) => r.meta?.sidebar)
    .map((r) => ({
      name: String(r.name),
      title: String(r.meta?.title ?? r.name),
      icon: r.meta?.icon,
    }));
});

/** tools 等带子路由的入口按路径前缀判定激活 */
const activeName = computed(() => {
  const matched = navItems.value.find(
    (item) =>
      route.name === item.name ||
      (item.name === 'tools' && route.path.startsWith('/tools')),
  );
  return matched?.name ?? '';
});

function go(name: string) {
  void router.push({ name });
}

const userOptions = [
  { label: '修改密码', key: 'change-password', icon: () => h(KeyOutline) },
  { label: '退出登录', key: 'logout', icon: () => h(LogOutOutline) },
];

function onUserAction(key: string) {
  if (key === 'logout') {
    authStore.clearAuth();
    void router.push({ name: 'login' });
  } else if (key === 'change-password') {
    // TODO(下一轮)：修改密码弹窗（PATCH /auth/password）
  }
}
</script>

<template>
  <aside
    class="glass-panel w-18 h-full flex flex-col items-center py-4 gap-2 shrink-0"
  >
    <!-- Logo -->
    <div
      class="rail-icon-active w-11 h-11 mb-2 flex items-center justify-center rounded-xl"
    >
      <NIcon :size="24"><CloudOutline /></NIcon>
    </div>

    <!-- 系统功能导航 -->
    <nav class="flex flex-col gap-1.5 overflow-y-auto w-full items-center">
      <NTooltip
        v-for="item in navItems"
        :key="item.name"
        placement="right"
        :delay="300"
      >
        <template #trigger>
          <button
            class="rail-icon cursor-pointer border-none bg-transparent"
            :class="{ 'rail-icon-active': activeName === item.name }"
            @click="go(item.name)"
          >
            <NIcon :size="22" :component="item.icon" />
          </button>
        </template>
        {{ item.title }}
      </NTooltip>
    </nav>

    <div class="flex-1" />

    <!-- 主题切换 -->
    <NTooltip placement="right" :delay="300">
      <template #trigger>
        <button
          class="rail-icon cursor-pointer border-none bg-transparent"
          @click="appStore.toggleDark()"
        >
          <NIcon :size="22">
            <SunnyOutline v-if="appStore.isDark" />
            <MoonOutline v-else />
          </NIcon>
        </button>
      </template>
      {{ appStore.isDark ? '切换浅色' : '切换深色' }}
    </NTooltip>

    <!-- 当前用户 -->
    <NDropdown
      trigger="click"
      placement="right-end"
      :options="userOptions"
      @select="onUserAction"
    >
      <div class="cursor-pointer">
        <NAvatar
          round
          size="medium"
          class="bg-brand-600! text-white align-middle"
        >
          {{ authStore.user?.username?.slice(0, 1).toUpperCase() ?? 'U' }}
        </NAvatar>
      </div>
    </NDropdown>
  </aside>
</template>
