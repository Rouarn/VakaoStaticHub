<script setup lang="ts">
import { onMounted, ref } from 'vue';
import PdfPreview from './pdf-preview.vue';
import PreviewOverlay from './preview-overlay.vue';
import type { PreviewProps } from './types';
import { withPdfConversion } from '@/utils/preview-source';

/**
 * Word 预览：docx-preview 渲染到容器。
 * 渲染失败（含旧版 .doc）时自动改用服务端转换的 PDF，
 * 不再为旧格式单独维护提示分支。
 */
const props = defineProps<PreviewProps>();
const container = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const fallbackSrc = ref('');

onMounted(async () => {
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
  } catch {
    fallbackSrc.value = withPdfConversion(props.src, props.version);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <PdfPreview
    v-if="fallbackSrc"
    :src="fallbackSrc"
    :filename="props.filename"
    :size="props.size"
    :version="props.version"
    :download-src="props.downloadSrc"
  />
  <div v-else class="w-full h-full relative">
    <div class="w-full h-full overflow-auto">
      <div ref="container" class="docx-body mx-auto" />
    </div>
    <PreviewOverlay
      v-if="loading"
      state="loading"
      title="正在解析文档…"
      hint="按原排版在浏览器内渲染，长文档需要一点时间"
    />
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
