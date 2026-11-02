<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { RouterView } from 'vue-router';
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  zhCN,
  dateZhCN,
} from 'naive-ui';
import { useAppStore } from '@/stores/modules/app';
import {
  lightThemeOverrides,
  darkThemeOverrides,
} from '@/config/naive-theme';

const appStore = useAppStore();

// 启动时恢复持久化的主题偏好，切换时同步 <html> 的 dark class（驱动 UnoCSS dark: 变体）
watchEffect(() => {
  appStore.applyDarkClass();
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
        <RouterView />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
