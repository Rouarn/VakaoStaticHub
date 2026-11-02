<script setup lang="ts">
import { ImageOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="占位图生成"
    description="自定义尺寸 / 文字 / 配色的占位图生成工具。"
    :icon="ImageOutline"
    :features="['尺寸与文字配置', '配色方案', '一键复制链接']"
  />
</template>
