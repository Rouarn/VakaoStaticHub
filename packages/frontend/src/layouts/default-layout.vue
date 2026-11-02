<script setup lang="ts">
import { computed } from 'vue';
import { RouterView } from 'vue-router';
import { useAppStore } from '@/stores/modules/app';
import SystemSidebar from './components/system-sidebar.vue';
import CategoryPanel from './components/category-panel.vue';

/**
 * 双轨制布局外壳
 *
 * - System Sidebar（72px）：系统级固定功能，纯图标 + Tooltip
 * - Category Panel（240px）：用户动态资源分类，独立玻璃面板 + 独立滚动
 * - Main Content：主内容区，路由过渡 + 独立滚动
 *
 * 背景光晕层按主题切换（aurora-light / aurora-dark，色值来自 design-tokens）
 */
const appStore = useAppStore();
const auroraClass = computed(() =>
  appStore.isDark ? 'aurora-dark' : 'aurora-light',
);
</script>

<template>
  <div class="page-bg text-ink relative h-full w-full overflow-hidden">
    <!-- 背景光晕层（浅色：左上紫 + 右上粉 / 深色：暗紫 + 暗青） -->
    <div
      class="pointer-events-none absolute inset-0 transition-opacity duration-500"
      :class="auroraClass"
    />

    <div class="relative h-full flex gap-4 p-4">
      <SystemSidebar />
      <CategoryPanel />

      <!-- 主内容区 -->
      <main class="min-w-0 flex-1 overflow-y-auto">
        <RouterView v-slot="{ Component }">
          <Transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
