<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { NSpin } from 'naive-ui';
import { renderAsync } from 'docx-preview';

interface Props {
  /** docx 文件直链（旧版 .doc 二进制格式不支持） */
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
const containerRef = ref<HTMLDivElement | null>(null);
// 异步渲染与 src 切换的竞态守卫：每次加载递增，回调时校验
let loadGeneration = 0;

const init = async () => {
  if (!props.src || !containerRef.value) return;

  loading.value = true;
  const generation = ++loadGeneration;
  containerRef.value.innerHTML = '';

  try {
    const res = await fetch(props.src);
    if (!res.ok) throw new Error(`文件加载失败（HTTP ${res.status}）`);
    const buffer = await res.arrayBuffer();
    if (generation !== loadGeneration || !containerRef.value) return;

    await renderAsync(buffer, containerRef.value, undefined, {
      inWrapper: true,
      breakPages: true,
    });
    if (generation !== loadGeneration) return;

    loading.value = false;
    emit('ready');
    emit('load');
  } catch (error) {
    if (generation !== loadGeneration) return;
    loading.value = false;
    emit('error', error instanceof Error ? error : new Error('文档解析失败'));
  }
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
  loadGeneration++;
});

defineExpose({
  reload: init,
});
</script>

<template>
  <div class="docx-preview-wrap relative w-full h-full overflow-auto bg-base">
    <div ref="containerRef" class="docx-container" />
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
/* docx-preview 渲染的页面为白底文档样式，与明暗主题无关 */
.docx-container :deep(.docx-wrapper) {
  padding: 16px;
  background: transparent;
}

.docx-container :deep(.docx-wrapper > section.docx) {
  margin: 0 auto 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
</style>
