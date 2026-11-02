<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

/** 指标卡：标签 + 主值 + 辅助说明，用于系统状态/存储统计等页 */
defineProps<{
  label: string;
  value: string;
  hint?: string;
  icon?: Component;
}>();
</script>

<template>
  <div class="glass-card px-4 py-3 flex items-start gap-3 min-w-0">
    <div
      v-if="icon"
      class="glass-chip w-9 h-9 flex items-center justify-center shrink-0"
    >
      <NIcon :size="18" class="text-brand-600 dark:text-brand-400">
        <component :is="icon" />
      </NIcon>
    </div>
    <div class="min-w-0">
      <p class="m-0 text-11px text-ink-sub">{{ label }}</p>
      <p class="m-0 mt-1 text-18px font-600 text-ink truncate" :title="value">
        {{ value }}
      </p>
      <p
        v-if="hint"
        class="m-0 mt-0.5 text-11px text-ink-sub truncate"
        :title="hint"
      >
        {{ hint }}
      </p>
    </div>
  </div>
</template>
