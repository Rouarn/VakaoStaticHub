<script setup lang="ts">
import { RocketOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="APP 版本管理"
    description="多应用独立版本线：上传、发布门禁、灰度与强更策略、回滚。"
    :icon="RocketOutline"
    :features="[
      '版本列表（按 appKey 隔离）',
      'APK 上传 / 草稿',
      '全量 / 灰度发布',
      '下架（手动）与回滚（auto 候选）',
      '强制更新配置',
      '应用创建 / 重命名 / 删除（严格确认）',
    ]"
  />
</template>
