<script setup lang="ts">
import { CodeSlashOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="API 接口文档"
    description="接口说明与示例代码展示（highlight.js 渲染），不再 iframe 嵌 Swagger。"
    :icon="CodeSlashOutline"
    :features="['接口清单', 'highlight.js 代码高亮', '请求示例 / 响应示例']"
  />
</template>
