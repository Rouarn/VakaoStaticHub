<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { NSpin } from 'naive-ui';
import hljs from 'highlight.js/lib/common';
import { fetchText } from '@/utils/text-decode';
import { getFileExtension, codeExtensions } from '@/utils/file-types';
import { useHljsTheme } from '@/utils/hljs-theme';

interface Props {
  /** 文本/代码文件直链 */
  src: string;
  /** 用于推断语言的文件名，缺省时从 src 路径推断 */
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

/** 扩展名 → highlight.js 语言名（仅覆盖 codeExtensions 内的语言） */
const CODE_LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',
  css: 'css',
  json: 'json',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  go: 'go',
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
};

/** 超大文件不做语法高亮（高亮计算与 DOM 都会明显卡顿） */
const HIGHLIGHT_MAX_LENGTH = 200_000;

const loading = ref(true);
const content = ref('');
// 异步加载与 src 切换的竞态守卫：每次加载递增，回调时校验
let loadGeneration = 0;

const resolveFilename = () => {
  if (props.filename) return props.filename;
  try {
    return new URL(props.src).pathname.split('/').pop() || props.src;
  } catch {
    return props.src;
  }
};

const ext = computed(() => getFileExtension(resolveFilename()));

const language = computed(() => {
  if (!codeExtensions.includes(ext.value)) return null;
  const lang = CODE_LANGUAGE_MAP[ext.value];
  return lang && hljs.getLanguage(lang) ? lang : null;
});

const highlightedHtml = computed(() => {
  if (!language.value || !content.value) return '';
  if (content.value.length > HIGHLIGHT_MAX_LENGTH) return '';
  return hljs.highlight(content.value, { language: language.value }).value;
});

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
  <div class="text-preview relative w-full h-full overflow-auto bg-base">
    <pre
      v-if="highlightedHtml"
      class="code-block"
    ><code class="hljs" v-html="highlightedHtml" /></pre>
    <pre v-else class="plain-block"><code>{{ content }}</code></pre>
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
.text-preview pre {
  margin: 0;
  padding: 16px;
  min-height: 100%;
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    monospace;
  font-size: 13px;
  line-height: 1.6;
  box-sizing: border-box;
}

/* 纯文本：自动换行，避免长行横向滚动 */
.plain-block {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--n-text-color, inherit);
}

/* 代码：保持原始缩进，横向滚动；背景色由 hljs 主题提供 */
.code-block {
  white-space: pre;
}

.code-block .hljs {
  background: transparent;
  padding: 0;
}
</style>
