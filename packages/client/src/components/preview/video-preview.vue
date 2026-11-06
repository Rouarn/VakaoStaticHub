<script setup lang="ts">
import { ref } from 'vue';
import type { PreviewProps } from './types';

/**
 * 视频预览：原生 video 元素（依赖后端 HTTP Range 边下边播）
 * mkv/avi 浏览器无法解码时由 error 事件给出可读回退提示
 */
const props = defineProps<PreviewProps>();
const failed = ref(false);
</script>

<template>
  <div class="w-full h-full flex items-center justify-center">
    <p v-if="failed" class="text-ink-sub text-13px">
      当前浏览器无法解码该视频编码，建议下载后本地播放
    </p>
    <video
      v-else
      :src="props.src"
      class="max-w-full max-h-full rounded-xl bg-black"
      controls
      preload="metadata"
      playsinline
      @error="failed = true"
    />
  </div>
</template>
