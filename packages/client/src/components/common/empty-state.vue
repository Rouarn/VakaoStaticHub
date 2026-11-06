<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

/**
 * 统一空状态：玻璃虚线容器 + 品牌光晕图标 + 说明 + 可选主操作。
 * 各页面不允许再写「暂无数据」式的一行文本。
 */
const props = withDefaults(
  defineProps<{
    icon?: Component;
    title: string;
    description?: string;
    /** 嵌在已有面板里时传 true，避免卡片套卡片 */
    flat?: boolean;
  }>(),
  { flat: false },
);
</script>

<template>
  <div
    class="px-6 py-12 flex flex-col items-center text-center gap-3"
    :class="props.flat ? '' : 'glass-panel'"
  >
    <div
      v-if="icon"
      class="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--mat-chip)] border border-solid border-[var(--mat-line)] text-ink-sub"
    >
      <NIcon :size="20"><component :is="icon" /></NIcon>
    </div>
    <p class="m-0 text-13.5px font-600 text-ink">{{ title }}</p>
    <p
      v-if="description"
      class="m-0 max-w-420px text-12px text-ink-sub leading-5"
    >
      {{ description }}
    </p>
    <div
      v-if="$slots.default"
      class="mt-1 flex items-center gap-2 flex-wrap justify-center"
    >
      <slot />
    </div>
  </div>
</template>
