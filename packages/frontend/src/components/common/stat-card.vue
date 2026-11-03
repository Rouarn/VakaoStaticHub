<script setup lang="ts">
import type { Component } from 'vue';

/** 指标卡：标签 + 主值 + 辅助说明（对齐原型：无图标气泡、数字 tabular） */
defineProps<{
  label: string;
  value: string;
  hint?: string;
  icon?: Component;
}>();
</script>

<template>
  <div class="glass-card px-4 py-3.5 min-w-0">
    <p class="m-0 text-11px text-ink-sub">{{ label }}</p>
    <p
      class="m-0 mt-1 text-22px font-600 text-ink leading-tight truncate tabular-nums"
      :title="value"
    >
      {{ value }}
    </p>
    <p
      v-if="hint"
      class="m-0 mt-1 text-11px text-ink-sub truncate"
      :title="hint"
    >
      {{ hint }}
    </p>
  </div>
</template>
