<script setup lang="ts">
import { DocumentTextOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="审计日志"
    description="关键操作审计：动作与资源类型中文标签 + 原始值悬浮提示，详情弹窗双语展示。"
    :icon="DocumentTextOutline"
    :features="['操作流水列表', '中文标签 + 原始值 tooltip', '详情弹窗']"
  />
</template>
