<script setup lang="ts">
import type { Component } from 'vue';
import { NIcon } from 'naive-ui';

/**
 * 占位视图（本轮未实现页面的统一空状态设计）
 *
 * 玻璃卡片 + 渐变图标 + 功能点 chips + 建设中标记；
 * features 用于声明该视图在功能清单中的覆盖范围，防止后续轮次遗漏。
 */
defineProps<{
  title: string;
  description: string;
  icon: Component;
  features?: string[];
}>();
</script>

<template>
  <div class="h-full flex items-center justify-center p-6">
    <div class="glass-card max-w-150 w-full px-10 py-12 text-center">
      <div
        class="mx-auto mb-6 w-16 h-16 rounded-2xl flex items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lift dark:shadow-lift-dark"
      >
        <NIcon :size="30" :component="icon" />
      </div>
      <h1 class="m-0 mb-2 text-xl font-600 text-ink">{{ title }}</h1>
      <p class="m-0 mb-6 text-13px text-ink-sub leading-relaxed">
        {{ description }}
      </p>
      <ul
        v-if="features?.length"
        class="m-0 mb-6 p-0 list-none flex flex-wrap justify-center gap-2"
      >
        <li
          v-for="feature in features"
          :key="feature"
          class="glass-chip px-3 py-1 text-12px text-ink-sub"
        >
          {{ feature }}
        </li>
      </ul>
      <span
        class="inline-block px-3 py-1 rounded-full border border-dashed border-brand-400 text-brand-500 dark:text-brand-400 text-12px"
      >
        功能建设中 · 下一轮交付
      </span>
    </div>
  </div>
</template>
