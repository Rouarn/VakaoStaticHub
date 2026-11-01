<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { NSpin, NButton, NIcon } from 'naive-ui';
import { AddOutline, RemoveOutline } from '@vicons/ionicons5';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface Props {
  /** PDF 文件直链（后端已支持 Range，pdfjs 按需分片加载） */
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

const SCALE_STEP = 0.25;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;

const loading = ref(true);
const scale = ref(1);
const pageCount = ref(0);
const renderedCount = ref(0);
const scrollRef = ref<HTMLDivElement | null>(null);
const pagesRef = ref<HTMLDivElement | null>(null);

let pdfDoc: PDFDocumentProxy | null = null;
let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
// 渲染与缩放/src 切换的竞态守卫：每次渲染任务递增，逐页校验
let renderGeneration = 0;

const clampScale = (value: number) =>
  Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));

/** 按容器宽度自适应（左右各留 16px 边距） */
const fitWidthScale = async (): Promise<number> => {
  if (!pdfDoc || !scrollRef.value) return 1;
  const page = await pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const available = scrollRef.value.clientWidth - 32;
  return clampScale(available > 0 ? available / viewport.width : 1);
};

const destroyDoc = () => {
  pdfDoc = null;
  if (loadingTask) {
    void loadingTask.destroy();
    loadingTask = null;
  }
};

const renderAllPages = async (generation: number) => {
  if (!pdfDoc || !pagesRef.value) return;

  const container = pagesRef.value;
  container.innerHTML = '';
  renderedCount.value = 0;
  const dpr = window.devicePixelRatio || 1;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    // 缩放/换文件/卸载后放弃后续页渲染
    if (generation !== renderGeneration) return;

    const page = await pdfDoc.getPage(pageNum);
    if (generation !== renderGeneration) return;

    const viewport = page.getViewport({ scale: scale.value });
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    const canvas = document.createElement('canvas');
    const cssWidth = Math.floor(viewport.width);
    const cssHeight = Math.floor(viewport.height);
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    await page.render({
      canvas,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise;

    if (generation !== renderGeneration) return;
    renderedCount.value = pageNum;

    if (pageNum === 1) {
      loading.value = false;
      emit('load');
    }
  }
};

const init = async () => {
  if (!props.src) return;

  const generation = ++renderGeneration;
  destroyDoc();
  loading.value = true;
  pageCount.value = 0;
  renderedCount.value = 0;

  try {
    // cMaps 随 public/cmaps 分发，支撑无内嵌字体的 CJK 文档
    const task = pdfjsLib.getDocument({
      url: props.src,
      cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
      cMapPacked: true,
    });
    loadingTask = task;
    const doc = await task.promise;
    if (generation !== renderGeneration) {
      void task.destroy();
      return;
    }

    pdfDoc = doc;
    pageCount.value = doc.numPages;
    scale.value = await fitWidthScale();
    if (generation !== renderGeneration) return;

    emit('ready');
    await renderAllPages(generation);
  } catch (error) {
    if (generation !== renderGeneration) return;
    loading.value = false;
    emit('error', error instanceof Error ? error : new Error('PDF 加载失败'));
  }
};

const zoom = (delta: number) => {
  scale.value = clampScale(Math.round((scale.value + delta) * 100) / 100);
  renderGeneration++;
  void renderAllPages(renderGeneration);
};

onMounted(init);

watch(
  () => props.src,
  (src, oldSrc) => {
    if (src && src !== oldSrc) {
      init();
    }
  },
);

onUnmounted(() => {
  renderGeneration++;
  destroyDoc();
});

defineExpose({
  reload: init,
});
</script>

<template>
  <div class="pdf-preview relative w-full h-full overflow-hidden bg-base">
    <div ref="scrollRef" class="absolute inset-0 overflow-auto">
      <div ref="pagesRef" class="pdf-pages py-4" />
    </div>

    <div
      v-if="pageCount > 0"
      class="absolute top-3 right-3 z-10 flex items-center gap-1 px-2 py-1 rounded-lg bg-base/90 shadow-md border border-base"
    >
      <NButton
        quaternary
        size="small"
        :focusable="false"
        @click="zoom(-SCALE_STEP)"
      >
        <template #icon>
          <NIcon><RemoveOutline /></NIcon>
        </template>
      </NButton>
      <span class="text-xs w-12 text-center select-none">
        {{ Math.round(scale * 100) }}%
      </span>
      <NButton
        quaternary
        size="small"
        :focusable="false"
        @click="zoom(SCALE_STEP)"
      >
        <template #icon>
          <NIcon><AddOutline /></NIcon>
        </template>
      </NButton>
    </div>

    <div
      v-if="loading"
      class="absolute inset-0 bg-base/80 flex items-center justify-center z-20"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>

<style scoped>
.pdf-pages :deep(.pdf-page) {
  margin: 0 auto 12px;
  width: fit-content;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.pdf-pages :deep(.pdf-page canvas) {
  display: block;
  background: #fff;
}
</style>
