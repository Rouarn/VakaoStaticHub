<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import MarkdownIt from 'markdown-it';
import type { PreviewProps } from './types';
import { fetchText } from './fetch-text';

/**
 * Markdown 预览：markdown-it 关闭 HTML 渲染（html:false），
 * 防止文件内容里的 <script>/<img onerror> 等注入，渲染结果可安全 v-html
 */
const props = defineProps<PreviewProps>();

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const rendered = ref('');
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const result = await fetchText(props.src);
    rendered.value = md.render(result.text);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Markdown 加载失败';
  } finally {
    loading.value = false;
  }
});

const state = computed(() => ({ loading: loading.value, error: error.value }));
</script>

<template>
  <div class="w-full h-full overflow-auto">
    <p v-if="state.error" class="text-13px text-ink-sub">{{ state.error }}</p>
    <p v-else-if="state.loading" class="text-13px text-ink-sub">加载中…</p>
    <article v-else class="md-body max-w-3xl mx-auto" v-html="rendered" />
  </div>
</template>

<style scoped>
.md-body {
  font-size: 14px;
  line-height: 1.75;
  color: var(--ink);
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3) {
  margin: 1.2em 0 0.6em;
  font-weight: 600;
}
.md-body :deep(h1) {
  font-size: 1.6em;
}
.md-body :deep(h2) {
  font-size: 1.35em;
}
.md-body :deep(p) {
  margin: 0.7em 0;
}
.md-body :deep(a) {
  color: #7c3aed;
  text-decoration: underline;
}
.md-body :deep(code) {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(125, 125, 155, 0.18);
  font-size: 0.92em;
}
.md-body :deep(pre) {
  padding: 14px;
  border-radius: 12px;
  background: rgba(20, 24, 36, 0.85);
  overflow-x: auto;
}
.md-body :deep(pre code) {
  background: transparent;
  padding: 0;
  color: #e6e6e6;
}
.md-body :deep(blockquote) {
  margin: 1em 0;
  padding-left: 12px;
  border-left: 3px solid rgba(124, 58, 237, 0.5);
  color: var(--ink-sub);
}
.md-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid rgba(140, 150, 170, 0.3);
  padding: 6px 10px;
  text-align: left;
}
.md-body :deep(img) {
  max-width: 100%;
  border-radius: 10px;
}
</style>
