<script setup lang="ts">
import { EyeOutline } from '@vicons/ionicons5';
import PublicPage from '@/components/common/public-page.vue';
import PlaceholderView from '@/components/common/placeholder-view.vue';

/**
 * 独立文件预览页（/file-preview，公开）
 * 按 URL 预览远程文件；下一轮接入 preview-registry 按格式分发预览组件。
 */
</script>

<template>
  <PublicPage>
    <PlaceholderView
      title="文件预览"
      description="输入远程文件 URL 即可预览，按格式自动分发到对应预览组件。"
      :icon="EyeOutline"
      :features="['URL 输入预览', 'preview-registry 格式分发', '默认兜底']"
    />
  </PublicPage>
</template>
