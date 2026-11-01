<script setup lang="ts">
import { ref, watch } from 'vue';
import { NSpin } from 'naive-ui';

interface Props {
  /** HTML 文件直链 */
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

const loading = ref(true);
const iframeRef = ref<HTMLIFrameElement | null>(null);

const handleLoad = () => {
  loading.value = false;
  emit('ready');
  emit('load');
};

const reload = () => {
  loading.value = true;
  if (iframeRef.value) {
    iframeRef.value.src = props.src;
  }
};

watch(
  () => props.src,
  (src, oldSrc) => {
    if (src && src !== oldSrc) {
      loading.value = true;
    }
  },
);

defineExpose({
  reload,
});
</script>

<template>
  <div class="html-preview relative w-full h-full bg-white overflow-hidden">
    <!--
      sandbox 放行脚本和下载：iframe 运行在 opaque origin，
      无法访问父页面 DOM / Cookie / localStorage，防 XSS；
      页面脚本可正常运行以保证 HTML 功能完整；
      allow-downloads 允许 HTML 内部触发的下载（导出、附件等）。
    -->
    <iframe
      ref="iframeRef"
      :src="src"
      sandbox="allow-scripts allow-downloads"
      class="w-full h-full border-0"
      @load="handleLoad"
    />
    <div
      v-if="loading"
      class="absolute inset-0 bg-white/80 flex items-center justify-center z-10"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>
