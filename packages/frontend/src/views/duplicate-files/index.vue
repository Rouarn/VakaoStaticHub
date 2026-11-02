<script setup lang="ts">
import { CopyOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="重复文件检测"
    description="按内容哈希聚合重复文件，辅助空间清理。"
    :icon="CopyOutline"
    :features="['重复分组列表', '保留 / 清理操作']"
  />
</template>
