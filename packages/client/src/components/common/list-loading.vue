<script setup lang="ts">
import { NSpin } from 'naive-ui';

/**
 * 列表加载遮罩（全站唯一实现）
 *
 * 覆盖父级内容区的可视范围，让转圈与提示在垂直、水平方向居中。
 * 父容器需带 relative 与明确高度（如 flex-1 min-h-0），居中不随内容高度或滚动位置偏移。
 */
defineProps<{
  show: boolean;
  /** 中文加载提示，统一由 useListLoading 生成 */
  text: string;
}>();
</script>

<template>
  <div
    v-if="show"
    class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/70 dark:bg-black/40 backdrop-blur-[2px]"
    role="status"
    aria-live="polite"
  >
    <NSpin size="large" />
    <p class="m-0 text-13px text-ink-sub">{{ text }}</p>
  </div>
</template>
