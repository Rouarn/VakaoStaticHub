<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue';
import { resolvePreview } from '@/utils/preview-registry';

interface Props {
  fileUrl: string;
}

interface Emits {
  (e: 'ready'): void;
  (e: 'load'): void;
  (e: 'error', error: Error): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const filename = computed(() => {
  try {
    return new URL(props.fileUrl).pathname.split('/').pop() || 'file';
  } catch {
    return props.fileUrl.split('/').pop() || 'file';
  }
});

// 注册表分发：每种可预览类型对应一个懒加载组件（进入预览页时才拉取对应 chunk）
const AsyncPreview = computed(() => {
  const resolution = resolvePreview(filename.value);
  return resolution.kind === 'component'
    ? defineAsyncComponent(resolution.loader)
    : null;
});

const previewRef = ref<{ reload?: () => void } | null>(null);

const reload = () => {
  previewRef.value?.reload?.();
};

defineExpose({
  reload,
});
</script>

<template>
  <div class="w-full h-full relative">
    <component
      :is="AsyncPreview"
      v-if="AsyncPreview"
      ref="previewRef"
      :src="fileUrl"
      :filename="filename"
      @ready="emit('ready')"
      @load="emit('load')"
      @error="(err: Error) => emit('error', err)"
    />
  </div>
</template>
