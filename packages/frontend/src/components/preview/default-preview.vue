<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import { DownloadOutline } from '@vicons/ionicons5';
import type { PreviewProps } from './types';
import { formatBytes, formatTime } from '@/utils/file-types';

/**
 * 默认兜底预览：无法解析的格式展示元信息并提供下载
 * 独立预览页 / 卡片弹窗都会落到这里，保证任何文件都有可用的落地视图
 */
const props = defineProps<PreviewProps>();
</script>

<template>
  <div class="w-full h-full flex items-center justify-center">
    <div class="glass-card px-10 py-10 text-center max-w-110">
      <p class="m-0 text-15px font-600 text-ink truncate">
        {{ props.filename }}
      </p>
      <p class="m-0 mt-2 text-12px text-ink-sub">
        {{ formatBytes(props.size) }} · {{ formatTime(Date.now()) }}
      </p>
      <p class="m-0 mt-4 text-12px text-ink-sub">
        该格式暂不支持在线预览，可下载后本地打开
      </p>
      <NButton tag="a" :href="props.src" download type="primary" class="mt-5">
        <template #icon
          ><NIcon><DownloadOutline /></NIcon
        ></template>
        下载文件
      </NButton>
    </div>
  </div>
</template>
