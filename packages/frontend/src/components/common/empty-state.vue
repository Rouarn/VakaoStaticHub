<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

/**
 * 统一空状态：玻璃虚线容器 + 品牌光晕图标 + 说明 + 可选主操作。
 * 各页面不允许再写「暂无数据」式的一行文本。
 */
defineProps<{
  icon?: Component;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div
    class="glass-panel border-dashed! px-6 py-10 flex flex-col items-center text-center gap-3 relative overflow-hidden"
  >
    <div
      class="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full bg-brand-300/20 dark:bg-brand-500/10 blur-3xl"
    />
    <div
      v-if="icon"
      class="relative glass-chip w-14 h-14 flex items-center justify-center"
    >
      <NIcon :size="28" class="text-brand-600 dark:text-brand-400">
        <component :is="icon" />
      </NIcon>
    </div>
    <p class="m-0 text-14px font-600 text-ink">{{ title }}</p>
    <p v-if="description" class="m-0 max-w-420px text-12px text-ink-sub leading-5">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-1 flex items-center gap-2 flex-wrap justify-center">
      <slot />
    </div>
  </div>
</template>
