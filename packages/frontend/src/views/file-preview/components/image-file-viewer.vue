<script setup lang="ts">
import { ref, watch } from 'vue';
import { NImage } from 'naive-ui';

interface Props {
  /** 图片文件直链 */
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

const reloadKey = ref(0);

const handleLoad = () => {
  emit('ready');
  emit('load');
};

const handleError = () => {
  emit('error', new Error('图片加载失败'));
};

const reload = () => {
  reloadKey.value++;
};

watch(
  () => props.src,
  (src, oldSrc) => {
    if (src && src !== oldSrc) {
      reloadKey.value++;
    }
  },
);

defineExpose({
  reload,
});
</script>

<template>
  <div class="image-viewer w-full h-full flex items-center justify-center bg-base overflow-hidden">
    <!-- NImage 自带点击查看原图与缩放，object-fit 保持完整画面 -->
    <NImage
      :key="reloadKey"
      :src="src"
      :alt="filename || 'image'"
      :preview-src="src"
      object-fit="contain"
      class="max-w-full max-h-full"
      @load="handleLoad"
      @error="handleError"
    />
  </div>
</template>
