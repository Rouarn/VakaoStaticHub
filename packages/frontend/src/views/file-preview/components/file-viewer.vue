<script setup lang="ts">
import { ref, onUnmounted, nextTick, watch, onMounted, computed } from 'vue';
import { loadJitViewer, type ViewerInstance } from '@/utils/jit-viewer-loader';
import VideoPreview from '@/components/video-preview.vue';
import { NSpin } from 'naive-ui';
import { isImage, isVideo } from '@/utils/file-types';

interface Props {
  fileUrl: string;
  theme?: 'light' | 'dark';
}

interface Emits {
  (e: 'ready'): void;
  (e: 'load'): void;
  (e: 'error', error: Error): void;
}

const props = withDefaults(defineProps<Props>(), {
  theme: 'light',
});
const emit = defineEmits<Emits>();

const viewerRef = ref<HTMLDivElement | null>(null);
let viewerInstance: ViewerInstance | null = null;
let mutationObserver: MutationObserver | null = null;
const loading = ref(false);
const isMounted = ref(false);

const filename = computed(() => {
  try {
    return new URL(props.fileUrl).pathname.split('/').pop() || 'file';
  } catch {
    return props.fileUrl.split('/').pop() || 'file';
  }
});

// 视频走专属流式预览组件（video.js + 后端 Range），不经过 jit-viewer 的整文件下载逻辑
const isVideoFile = computed(() => isVideo(filename.value));
const videoPreviewRef = ref<InstanceType<typeof VideoPreview> | null>(null);

const destroyViewer = () => {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (viewerInstance) {
    viewerInstance.destroy();
    viewerInstance = null;
  }
};

const triggerFitScreen = () => {
  if (!viewerRef.value) return;
  const fitBtn = viewerRef.value.querySelector(
    '.jv-image-btn[title="实际大小"]',
  );
  if (fitBtn) {
    (fitBtn as HTMLElement).click();
    return true;
  }
  return false;
};

const initViewer = async () => {
  if (!isMounted.value || !props.fileUrl) return;

  // 视频文件交由 VideoPreview 组件处理（自身管理加载态/错误/重建）
  if (isVideoFile.value) {
    destroyViewer();
    loading.value = false;
    return;
  }

  if (!viewerRef.value) return;

  destroyViewer();
  loading.value = true;

  await nextTick();

  try {
    // 动态加载 jit-viewer，使预览页外壳与 loading 先渲染，SDK 随后就位
    const { createViewer } = await loadJitViewer();
    const isImageFile = isImage(filename.value);

    viewerInstance = createViewer({
      target: viewerRef.value,
      file: props.fileUrl,
      filename: filename.value,
      theme: props.theme,
      toolbar: true,
      width: '100%',
      height: '100%',
      onReady: () => {
        loading.value = false;
        emit('ready');
      },
      onLoad: () => {
        loading.value = false;
        emit('load');

        if (isImageFile && viewerRef.value) {
          if (triggerFitScreen()) {
            return;
          }

          mutationObserver = new MutationObserver(() => {
            if (triggerFitScreen()) {
              mutationObserver?.disconnect();
              mutationObserver = null;
            }
          });

          mutationObserver.observe(viewerRef.value, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          setTimeout(() => {
            if (mutationObserver) {
              mutationObserver.disconnect();
              mutationObserver = null;
            }
          }, 500);
        }
      },
      onError: (err) => {
        loading.value = false;
        emit('error', err);
      },
    });

    viewerInstance.mount();
  } catch (error) {
    loading.value = false;
    emit(
      'error',
      error instanceof Error ? error : new Error('初始化预览器失败'),
    );
  }
};

onMounted(() => {
  isMounted.value = true;
  if (props.fileUrl) {
    initViewer();
  }
});

watch(
  () => props.fileUrl,
  () => {
    if (isMounted.value && props.fileUrl) {
      initViewer();
    } else if (!props.fileUrl) {
      destroyViewer();
    }
  },
);

watch(
  () => props.theme,
  () => {
    // 视频播放器 UI 与主题无关，仅 jit-viewer 需要随主题重建
    if (isMounted.value && props.fileUrl && !isVideoFile.value) {
      initViewer();
    }
  },
);

onUnmounted(() => {
  destroyViewer();
});

const reload = () => {
  if (isVideoFile.value) {
    videoPreviewRef.value?.reload();
    return;
  }
  initViewer();
};

defineExpose({
  reload,
  destroy: destroyViewer,
});
</script>

<template>
  <div class="w-full h-full relative">
    <VideoPreview
      v-if="isVideoFile"
      ref="videoPreviewRef"
      :src="fileUrl"
      :filename="filename"
      @ready="emit('ready')"
      @load="emit('load')"
      @error="(err: Error) => emit('error', err)"
    />
    <div v-else ref="viewerRef" style="width: 100%; height: 100%"></div>
    <div
      v-if="loading && !isVideoFile"
      class="absolute inset-0 bg-white/80 dark:bg-black/80 flex items-center justify-center z-10"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>
