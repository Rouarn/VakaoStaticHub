<script setup lang="ts">
import { NIcon, NSpin } from 'naive-ui';
import { AlertCircleOutline } from '@vicons/ionicons5';

/**
 * 预览状态遮罩（转换/解析等待与失败）
 *
 * 覆盖预览内容区，与列表加载遮罩同一套观感：半透明底 + 模糊 + 居中提示，
 * 避免「转换要等十几秒」被误认为卡死。父容器需带 relative 与明确高度。
 */
defineProps<{
  state: 'loading' | 'error';
  /** 主提示，一句话说明正在做什么或为什么失败 */
  title: string;
  /** 补充说明，例如耗时预期、可替代操作 */
  hint?: string;
}>();
</script>

<template>
  <div
    class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 dark:bg-black/50 backdrop-blur-[3px] px-6 text-center"
    role="status"
    aria-live="polite"
  >
    <NSpin v-if="state === 'loading'" size="large" />
    <NIcon v-else :size="34" class="text-ink-sub"><AlertCircleOutline /></NIcon>
    <p class="m-0 text-14px text-ink">{{ title }}</p>
    <p v-if="hint" class="m-0 max-w-80 text-13px leading-relaxed text-ink-sub">
      {{ hint }}
    </p>
  </div>
</template>
