<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PreviewProps } from './types';

/**
 * Word 预览：docx-preview 渲染到容器
 * .doc（二进制旧格式）不支持，给出可读回退提示
 */
const props = defineProps<PreviewProps>();
const container = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  const isLegacyDoc = props.filename.toLowerCase().endsWith('.doc');
  if (isLegacyDoc) {
    error.value = '旧版 .doc 格式暂不支持预览，请下载或转换为 .docx';
    loading.value = false;
    return;
  }
  try {
    const resp = await fetch(props.src);
    if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
    const blob = await resp.blob();
    const { renderAsync } = await import('docx-preview');
    if (!container.value) throw new Error('容器未就绪');
    await renderAsync(blob, container.value, undefined, {
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Word 文档加载失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="w-full h-full overflow-auto">
    <p v-if="error" class="text-13px text-ink-sub">{{ error }}</p>
    <p v-else-if="loading" class="text-13px text-ink-sub">文档解析中…</p>
    <div ref="container" class="docx-body mx-auto" />
  </div>
</template>

<style scoped>
.docx-body :deep(.docx-wrapper) {
  background: transparent;
  padding: 0;
}
.docx-body :deep(section.docx) {
  background: #fff;
  box-shadow: 0 8px 32px rgba(31, 38, 135, 0.12);
  border-radius: 8px;
  margin-bottom: 16px;
}
</style>
