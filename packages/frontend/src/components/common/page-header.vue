<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

/**
 * 业务页统一页头：标题 + 说明 + 右侧操作区
 * 图标底色来自 design-tokens（via uno theme），不散写色值。
 */
defineProps<{
  title: string;
  description?: string;
  icon?: Component;
}>();
</script>

<template>
  <header class="glass-panel px-5 py-4 flex items-center gap-3 flex-wrap">
    <div
      v-if="icon"
      class="glass-chip w-10 h-10 flex items-center justify-center shrink-0"
    >
      <NIcon :size="21" class="text-brand-600 dark:text-brand-400">
        <component :is="icon" />
      </NIcon>
    </div>
    <div class="min-w-0">
      <h1 class="m-0 text-16px font-600 text-ink leading-tight">{{ title }}</h1>
      <p v-if="description" class="m-0 mt-1 text-12px text-ink-sub">
        {{ description }}
      </p>
    </div>
    <div class="ml-auto flex items-center gap-2 flex-wrap">
      <slot name="actions" />
    </div>
  </header>
</template>
