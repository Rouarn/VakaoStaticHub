<script setup lang="ts">
import { FolderOpenOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="文件库"
    description="统一静态资源管理：多根目录切换、分类浏览、多格式预览（preview-registry 注册表驱动）。"
    :icon="FolderOpenOutline"
    :features="[
      '网格 / 列表视图',
      '普通上传 + 5MB 分片断点续传',
      '批量删除 / 移动 / 重命名',
      '复制链接 / 创建分享',
      '搜索 / 排序 / 分页',
      '图片·视频·音频·文本·Markdown·HTML·PDF·Word·Excel·压缩包预览',
    ]"
  />
</template>
