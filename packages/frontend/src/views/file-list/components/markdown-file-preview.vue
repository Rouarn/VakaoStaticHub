<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { NSpin } from 'naive-ui';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import { fetchText } from '@/utils/text-decode';
import { useHljsTheme } from '@/utils/hljs-theme';

interface Props {
  /** Markdown 文件直链 */
  src: string;
  filename?: string;
}

interface Emits {
  (e: 'ready'): void;
  (e: 'load'): void;
  (e: 'error', error: Error): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

useHljsTheme();

// html: false 转义原文中的 HTML 标签，渲染结果无 XSS 风险
const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(str, { language: lang }).value;
    }
    return '';
  },
});

const loading = ref(true);
const content = ref('');
// 异步加载与 src 切换的竞态守卫：每次加载递增，回调时校验
let loadGeneration = 0;

const renderedHtml = computed(() => md.render(content.value));

const init = async () => {
  if (!props.src) return;

  loading.value = true;
  const generation = ++loadGeneration;

  try {
    const text = await fetchText(props.src);
    if (generation !== loadGeneration) return;

    content.value = text;
    loading.value = false;
    emit('ready');
    emit('load');
  } catch (error) {
    if (generation !== loadGeneration) return;
    loading.value = false;
    emit('error', error instanceof Error ? error : new Error('文件加载失败'));
  }
};

onMounted(init);

watch(
  () => props.src,
  (src, oldSrc) => {
    if (src && src !== oldSrc) {
      content.value = '';
      init();
    }
  },
);

onUnmounted(() => {
  loadGeneration++;
});

defineExpose({
  reload: init,
});
</script>

<template>
  <div class="markdown-preview relative w-full h-full overflow-auto bg-base">
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="markdown-body" v-html="renderedHtml" />
    <div
      v-if="loading"
      class="absolute inset-0 bg-base/80 flex items-center justify-center z-10"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>

<style scoped>
.markdown-body {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 32px 48px;
  font-size: 15px;
  line-height: 1.75;
  word-break: break-word;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2) {
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}

.markdown-body :deep(h1) {
  font-size: 1.7em;
}

.markdown-body :deep(h2) {
  font-size: 1.4em;
}

.markdown-body :deep(h3) {
  font-size: 1.2em;
}

.markdown-body :deep(a) {
  color: #18a058;
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.15);
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  padding: 14px 16px;
  border-radius: 8px;
  overflow-x: auto;
  background: rgba(128, 128, 128, 0.1);
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 13px;
  line-height: 1.6;
}

.markdown-body :deep(blockquote) {
  margin: 0;
  padding: 0 16px;
  border-left: 4px solid #18a058;
  color: rgba(128, 128, 128, 1);
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 14px;
  border: 1px solid rgba(128, 128, 128, 0.35);
}

.markdown-body :deep(img) {
  max-width: 100%;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
}
</style>
