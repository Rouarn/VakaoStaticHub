<script setup lang="ts">
import type { Component } from 'vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';

/**
 * 业务页统一页头（对齐原型 topbar）
 *
 * 面包屑（路由 meta.group）+ 标题 + 说明 + 右侧操作区；
 * 图标参数保留兼容（原型 topbar 不再展示图标），页面无需改动调用方式。
 */
defineProps<{
  title: string;
  description?: string;
  icon?: Component;
}>();

const route = useRoute();
const group = computed(() => route.meta.group ?? '');
</script>

<template>
  <header
    class="glass-panel px-4 py-2.5 flex items-center gap-3 min-h-13 flex-wrap"
  >
    <div class="min-w-0 flex items-baseline gap-2.5 flex-wrap">
      <span v-if="group" class="text-11px text-ink-sub shrink-0">
        {{ group }} /
      </span>
      <h1
        class="m-0 text-15px font-600 text-ink leading-tight whitespace-nowrap"
      >
        {{ title }}
      </h1>
      <p v-if="description" class="m-0 text-12px text-ink-sub truncate">
        {{ description }}
      </p>
    </div>
    <div class="ml-auto flex items-center gap-2 flex-wrap">
      <slot name="actions" />
    </div>
  </header>
</template>
