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
  ChevronForwardOutline,
  ChevronBackOutline,
} from '@vicons/ionicons5';
import { routes } from '@/router/routes';
import { useAppStore } from '@/stores/modules/app';
import { useAuthStore } from '@/stores/modules/auth';

/**
 * System Sidebar
 *
 * 只放系统级功能入口（来自路由表 meta.sidebar）。
 * - 收起态：72px 纯图标 + Hover Tooltip
 * - 展开态：208px 图标 + 文字，此时不再显示 Tooltip
 * 用户动态资源分类在 Category Panel。
 */
const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();

const expanded = computed(() => appStore.sidebarExpanded);

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
    class="glass-panel h-full flex flex-col items-center py-4 shrink-0 overflow-hidden transition-all duration-300 ease-out box-border"
    :class="expanded ? 'w-52 px-3 gap-2' : 'w-18 px-2 gap-2'"
  >
    <!-- Logo -->
    <div
      class="flex items-center mb-1 shrink-0"
      :class="expanded ? 'w-full gap-2.5 px-1' : 'justify-center'"
    >
      <div
        class="rail-icon-active w-11 h-11 flex items-center justify-center rounded-xl shrink-0"
      >
        <NIcon :size="24"><CloudOutline /></NIcon>
      </div>
      <span
        v-if="expanded"
        class="text-ink text-sm font-600 whitespace-nowrap animate-fade-in"
      >
        静态资源
      </span>
    </div>

    <!-- 系统功能导航 -->
    <nav class="flex flex-col gap-1.5 overflow-y-auto w-full">
      <NTooltip
        v-for="item in navItems"
        :key="item.name"
        placement="right"
        :delay="300"
        :disabled="expanded"
      >
        <template #trigger>
          <button
            class="rail-icon cursor-pointer border-none bg-transparent shrink-0"
            :class="[
              activeName === item.name ? 'rail-icon-active' : '',
              expanded ? 'w-full! justify-start! gap-2.5 px-3' : 'w-11',
            ]"
            @click="go(item.name)"
          >
            <NIcon :size="22" class="shrink-0" :component="item.icon" />
            <span
              v-if="expanded"
              class="text-13px whitespace-nowrap animate-fade-in"
            >
              {{ item.title }}
            </span>
          </button>
        </template>
        {{ item.title }}
      </NTooltip>
    </nav>

    <div class="flex-1" />

    <!-- 展开 / 收起 -->
    <NTooltip placement="right" :delay="300" :disabled="expanded">
      <template #trigger>
        <button
          class="rail-icon cursor-pointer border-none bg-transparent shrink-0"
          :class="expanded ? 'w-full! justify-start! gap-2.5 px-3' : 'w-11'"
          @click="appStore.toggleSidebar()"
        >
          <NIcon :size="20" class="shrink-0">
            <ChevronForwardOutline v-if="!expanded" />
            <ChevronBackOutline v-else />
          </NIcon>
          <span
            v-if="expanded"
            class="text-13px whitespace-nowrap animate-fade-in"
          >
            收起菜单
          </span>
        </button>
      </template>
      展开菜单
    </NTooltip>

    <!-- 主题切换 -->
    <NTooltip placement="right" :delay="300" :disabled="expanded">
      <template #trigger>
        <button
          class="rail-icon cursor-pointer border-none bg-transparent shrink-0"
          :class="expanded ? 'w-full! justify-start! gap-2.5 px-3' : 'w-11'"
          @click="appStore.toggleDark()"
        >
          <NIcon :size="22" class="shrink-0">
            <SunnyOutline v-if="appStore.isDark" />
            <MoonOutline v-else />
          </NIcon>
          <span
            v-if="expanded"
            class="text-13px whitespace-nowrap animate-fade-in"
          >
            {{ appStore.isDark ? '切换浅色' : '切换深色' }}
          </span>
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
      <div
        class="cursor-pointer flex items-center rounded-xl shrink-0"
        :class="expanded ? 'w-full gap-2.5 px-2 py-1.5 hover:bg-white/60 dark:hover:bg-white/8' : ''"
      >
        <NAvatar
          round
          size="medium"
          class="bg-brand-600! text-white align-middle shrink-0"
        >
          {{ authStore.user?.username?.slice(0, 1).toUpperCase() ?? 'U' }}
        </NAvatar>
        <span
          v-if="expanded"
          class="text-13px text-ink-sub whitespace-nowrap truncate animate-fade-in"
        >
          {{ authStore.user?.username ?? '未登录' }}
        </span>
      </div>
    </NDropdown>
  </aside>
</template>
