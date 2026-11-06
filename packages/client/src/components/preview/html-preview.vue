<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { PreviewProps } from './types';
import { fetchText } from './fetch-text';

/**
 * HTML 预览：源隔离 iframe
 *
 * sandbox="" 表示同时禁用脚本、表单、弹窗，且不授予 allow-same-origin，
 * 页面运行在唯一不透明源内，无法读取父页面 DOM / Cookie / localStorage。
 * 用 Blob URL 承载内容，避免 srcDoc 注入到主文档上下文。
 */
const props = defineProps<PreviewProps>();

const blobUrl = ref('');
const loading = ref(true);
const error = ref('');
const truncated = ref(false);

onMounted(async () => {
  try {
    const result = await fetchText(props.src);
    truncated.value = result.truncated;
    blobUrl.value = URL.createObjectURL(
      new Blob([result.text], { type: 'text/html;charset=utf-8' }),
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'HTML 加载失败';
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
});
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <p class="m-0 mb-2 text-12px text-ink-sub">
      HTML 以沙箱渲染（脚本禁用、无同源权限）
      <span v-if="truncated">· 内容已截断</span>
    </p>
    <div
      v-if="error"
      class="flex-1 flex items-center justify-center text-13px text-ink-sub"
    >
      {{ error }}
    </div>
    <div
      v-else-if="loading"
      class="flex-1 flex items-center justify-center text-13px text-ink-sub"
    >
      加载中…
    </div>
    <iframe
      v-else
      :src="blobUrl"
      sandbox=""
      referrerpolicy="no-referrer"
      class="flex-1 min-h-0 w-full rounded-xl border border-glass-border dark:border-glass-border-dark bg-white"
      title="HTML 预览"
    />
  </div>
</template>
