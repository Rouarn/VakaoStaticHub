<script setup lang="ts">
import { PieChartOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="存储统计"
    description="按资源根目录与分类维度的容量使用情况图表。"
    :icon="PieChartOutline"
    :features="['根目录容量占比', '分类容量排行', '趋势概览']"
  />
</template>
