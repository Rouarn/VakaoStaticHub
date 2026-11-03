<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  dateZhCN,
} from 'naive-ui';
import { useAppStore } from '@/stores/modules/app';
import { lightThemeOverrides, darkThemeOverrides } from '@/config/naive-theme';
import AppBackdrop from '@/components/common/app-backdrop.vue';

const appStore = useAppStore();
const route = useRoute();

// 启动时恢复持久化的主题偏好，切换时同步 <html> 的 dark class（驱动 UnoCSS dark: 变体）
watchEffect(() => {
  appStore.applyDarkClass();
});

/**
 * 材质选择（决定壁纸与玻璃变量）
 *
 * - fluid：对外页（登录 / 分享访问 / 文件预览），高饱和彩色流体
 * - cool：管理端，冷灰玻璃，久看不累
 */
const material = computed<'cool' | 'fluid'>(() =>
  route.meta.public ? 'fluid' : 'cool',
);
watchEffect(() => {
  document.documentElement.dataset.material = material.value;
});

const naiveTheme = computed(() => (appStore.isDark ? darkTheme : null));
const themeOverrides = computed(() =>
  appStore.isDark ? darkThemeOverrides : lightThemeOverrides,
);
</script>

<template>
  <NConfigProvider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    class="h-full"
  >
    <NMessageProvider>
      <NDialogProvider>
        <AppBackdrop />
        <div class="relative z-1 h-full">
          <RouterView />
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
