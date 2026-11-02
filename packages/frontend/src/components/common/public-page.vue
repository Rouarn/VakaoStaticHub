<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '@/stores/modules/app';

/**
 * 公开页外壳（登录 / 分享访问 / 独立预览页）
 *
 * 这些页面不经过 DefaultLayout，需要自己提供页面底色与光晕层。
 */
const appStore = useAppStore();
const auroraClass = computed(() =>
  appStore.isDark ? 'aurora-dark' : 'aurora-light',
);
</script>

<template>
  <div class="page-bg text-ink relative h-full w-full overflow-hidden">
    <div class="pointer-events-none absolute inset-0" :class="auroraClass" />
    <div class="relative h-full w-full overflow-y-auto">
      <slot />
    </div>
  </div>
</template>
