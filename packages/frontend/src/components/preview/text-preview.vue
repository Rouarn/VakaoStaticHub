<script setup lang="ts">
import { onMounted, ref } from 'vue';
import 'highlight.js/styles/atom-one-dark.css';
import type { PreviewProps } from './types';
import { fetchText } from './fetch-text';
import { highlightCode, languageOf } from '@/utils/hljs';

/**
 * 文本 / 代码预览：highlight.js 按扩展名高亮
 * 文本体积上限见 fetch-text.ts，超限直接报错不渲染
 */
const props = defineProps<PreviewProps>();

const html = ref('');
const loading = ref(true);
const error = ref('');
const truncated = ref(false);

onMounted(async () => {
  try {
    const result = await fetchText(props.src);
    truncated.value = result.truncated;
    html.value = highlightCode(result.text, props.filename);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '文本加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <div class="mb-2 flex items-center gap-2 text-12px text-ink-sub">
      <span class="glass-chip px-2 py-0.5">{{ languageOf(props.filename) }}</span>
      <span v-if="truncated">内容超出上限，已截断显示</span>
    </div>
    <div v-if="error" class="flex-1 flex items-center justify-center text-13px text-ink-sub">
      {{ error }}
    </div>
    <div v-else-if="loading" class="flex-1 flex items-center justify-center text-13px text-ink-sub">
      加载中…
    </div>
    <pre
      v-else
      class="flex-1 min-h-0 m-0 overflow-auto rounded-xl bg-[#282c34] p-4 text-12px leading-relaxed"
    ><code v-html="html" /></pre>
  </div>
</template>
