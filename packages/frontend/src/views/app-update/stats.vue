<script setup lang="ts">
import { FunnelOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="升级漏斗统计"
    description="check → download → install 全链路转化率面板，按应用与版本钻取。"
    :icon="FunnelOutline"
    :features="['check / download / install 转化率', '按 appKey / 版本筛选', '失败原因分布']"
  />
</template>
