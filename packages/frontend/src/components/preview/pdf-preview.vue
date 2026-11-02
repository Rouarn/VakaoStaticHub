<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NIcon, NTooltip } from 'naive-ui';
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  AddOutline,
  RemoveOutline,
} from '@vicons/ionicons5';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { PreviewProps } from './types';

/**
 * PDF 预览：pdfjs-dist 渲染到 canvas（不依赖浏览器内置 PDF 插件）
 * worker 以 ?url 形式随 chunk 懒加载；cmaps 由 public/cmaps 提供，
 * 否则国产软件导出的中文 PDF 会渲染成空白
 */
const props = defineProps<PreviewProps>();

const canvasEl = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const error = ref('');
const pageNo = ref(1);
const pageCount = ref(0);
const zoom = ref(1.2);
const rendering = ref(false);

// 仅持有 pdf 文档句柄用于重渲染
let pdfDoc: PDFDocumentProxy | null = null;
let loadingTask: PDFDocumentLoadingTask | null = null;

async function renderPage() {
  if (!pdfDoc || !canvasEl.value || rendering.value) return;
  rendering.value = true;
  try {
    const page = await pdfDoc.getPage(pageNo.value);
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: zoom.value * dpr });
    // canvas 由 ref 持有并交给 Vue 管理：不要用 replaceChildren 之类的
    // 命令式 DOM 操作插入子节点，否则会破坏 Vue 的 v-if 锚点注释，
    // 触发 "insertBefore of null" 异常
    const canvas = canvasEl.value;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 初始化失败');
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'PDF 渲染失败';
  } finally {
    rendering.value = false;
  }
}

onMounted(async () => {
  try {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url'))
      .default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    loadingTask = pdfjs.getDocument({
      url: props.src,
      cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
      cMapPacked: true,
    });
    const doc = await loadingTask.promise;
    pdfDoc = doc;
    pageCount.value = doc.numPages;
    await renderPage();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'PDF 加载失败';
  } finally {
    loading.value = false;
  }
});

watch([pageNo, zoom], () => void renderPage());

onBeforeUnmount(() => {
  void loadingTask?.destroy();
});
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <div class="mb-2 flex items-center justify-center gap-1">
      <NTooltip :delay="300"><template #trigger>
        <NButton size="tiny" quaternary circle :disabled="pageNo <= 1" @click="pageNo--">
          <template #icon><NIcon :size="16"><ChevronBackOutline /></NIcon></template>
        </NButton>
      </template>上一页</NTooltip>
      <span class="text-12px text-ink-sub min-w-16 text-center">
        {{ pageNo }} / {{ pageCount || '—' }}
      </span>
      <NTooltip :delay="300"><template #trigger>
        <NButton size="tiny" quaternary circle :disabled="pageNo >= pageCount" @click="pageNo++">
          <template #icon><NIcon :size="16"><ChevronForwardOutline /></NIcon></template>
        </NButton>
      </template>下一页</NTooltip>
      <span class="mx-2 w-px h-4 bg-glass-border dark:bg-glass-border-dark" />
      <NButton size="tiny" quaternary circle @click="zoom = Math.max(0.4, zoom - 0.2)">
        <template #icon><NIcon :size="16"><RemoveOutline /></NIcon></template>
      </NButton>
      <span class="text-12px text-ink-sub w-12 text-center">{{ Math.round(zoom * 100) }}%</span>
      <NButton size="tiny" quaternary circle @click="zoom = Math.min(4, zoom + 0.2)">
        <template #icon><NIcon :size="16"><AddOutline /></NIcon></template>
      </NButton>
    </div>

    <div v-if="error" class="flex-1 flex items-center justify-center text-13px text-ink-sub">
      {{ error }}
    </div>
    <div
      v-else
      class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-2 relative"
    >
      <span
        v-if="loading"
        class="absolute text-13px text-ink-sub pointer-events-none"
      >
        PDF 加载中…
      </span>
      <canvas ref="canvasEl" class="rounded-xl shadow-glass max-w-full" />
    </div>
  </div>
</template>
