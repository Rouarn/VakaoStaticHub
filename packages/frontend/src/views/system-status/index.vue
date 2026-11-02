<script setup lang="ts">
import { SpeedometerOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="系统状态"
    description="服务运行指标面板：QPS、内存、存储、活跃分享等。"
    :icon="SpeedometerOutline"
    :features="['QPS / 请求统计', '内存占用', '存储用量', '活跃分享数']"
  />
</template>
