<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue';
import { NIcon, NModal, NSpin, NAlert, NButton } from 'naive-ui';
import { DocumentTextOutline } from '@vicons/ionicons5';
import {
  loadJitViewer,
  prefetchJitViewer,
  type ViewerInstance,
} from '@/utils/jit-viewer-loader';
import { prefetchVideoPlayer } from '@/utils/video-player-loader';
import VideoPreview from '@/components/video-preview.vue';
import { isSupported, isVideo } from '@/utils/file-types';
import { useDark } from '@vueuse/core';

const isDark = useDark();

const theme = computed(() => (isDark.value ? 'dark' : 'light'));

interface Props {
  filePath: string;
  fileUrl: (path: string) => string;
}

const props = defineProps<Props>();

const showModal = ref(false);
const loading = ref(false);
const loadError = ref(false);
const errorMessage = ref('');

const viewerRef = ref<HTMLDivElement | null>(null);
let viewerInstance: ViewerInstance | null = null;

// 视频走专属流式预览组件（video.js + 后端 Range），不经过 jit-viewer 的整文件下载逻辑
const isVideoFile = computed(() => isVideo(props.filePath));
const videoReloadKey = ref(0);

const previewUrl = () => props.fileUrl(props.filePath);

const handleClick = () => {
  showModal.value = true;
  loadError.value = false;
  errorMessage.value = '';

  if (isVideoFile.value) {
    // 加载态由 VideoPreview 内部 spinner 承担
    return;
  }

  if (isSupported(props.filePath)) {
    loading.value = true;
    initViewer();
  }
};

const handleVideoError = (err: Error) => {
  loadError.value = true;
  errorMessage.value = err.message || '视频加载失败';
};

const initViewer = async () => {
  await nextTick();
  if (!viewerRef.value) return;

  try {
    // 点击预览时才下载 jit-viewer（约 gzip 2.8MB），不阻塞首页渲染
    const { createViewer } = await loadJitViewer();
    viewerInstance = createViewer({
      target: viewerRef.value,
      file: previewUrl(),
      filename: props.filePath,
      theme: theme.value,
      toolbar: true,
      width: '100%',
      height: '100%',
      onReady: () => {
        loading.value = false;
      },
      onLoad: () => {
        loading.value = false;
      },
      onError: (err) => {
        loadError.value = true;
        errorMessage.value = err.message || '加载文档失败';
        loading.value = false;
      },
    });

    viewerInstance.mount();
  } catch (error) {
    loadError.value = true;
    errorMessage.value =
      error instanceof Error ? error.message : '初始化预览器失败';
    loading.value = false;
  }
};

const handleClose = () => {
  showModal.value = false;
  if (viewerInstance) {
    viewerInstance.destroy();
    viewerInstance = null;
  }
};

const handleReload = () => {
  if (isVideoFile.value) {
    // 通过 key 重建 VideoPreview 实现重试
    loadError.value = false;
    errorMessage.value = '';
    videoReloadKey.value++;
    return;
  }
  handleClick();
};

// 卡片渲染后趁浏览器空闲预取，首次点击预览时几乎无等待
onMounted(() => {
  if (isVideoFile.value) {
    prefetchVideoPlayer();
  } else if (isSupported(props.filePath)) {
    prefetchJitViewer();
  }
});

onUnmounted(() => {
  if (viewerInstance) {
    viewerInstance.destroy();
    viewerInstance = null;
  }
});

defineExpose({
  open: handleClick,
  close: handleClose,
});
</script>

<template>
  <div
    class="cursor-pointer hover:opacity-80 transition-opacity w-full h-full flex items-center justify-center"
    @click="handleClick"
  >
    <NIcon size="32" class="text-gray-400">
      <DocumentTextOutline />
    </NIcon>
  </div>

  <NModal
    v-model:show="showModal"
    :closable="true"
    :close-on-esc="true"
    :close-on-click-outside="false"
    @close="handleClose"
  >
    <div>
      <div
        v-if="isSupported(filePath)"
        class="max-w-4xl h-[75vh] mx-auto p-3 flex items-center justify-center bg-container rounded-xl overflow-hidden relative"
        :class="{ 'w-[80vw]': isVideoFile }"
      >
        <VideoPreview
          v-if="isVideoFile"
          :key="videoReloadKey"
          :src="previewUrl()"
          :filename="filePath"
          @error="handleVideoError"
        />
        <template v-else>
          <div ref="viewerRef" style="width: 100%; height: 100%"></div>
          <div
            v-if="loading"
            class="absolute inset-0 bg-white/80 flex items-center justify-center z-10"
          >
            <NSpin :show="loading" size="large">
              <template #description>加载中...</template>
            </NSpin>
          </div>
        </template>
      </div>

      <template v-else>
        <div
          class="flex flex-col items-center justify-center py-12 text-gray-400"
        >
          <NIcon size="64" class="mb-4">
            <DocumentTextOutline />
          </NIcon>
          <p>暂不支持此文件类型的预览</p>
          <a
            :href="previewUrl()"
            target="_blank"
            class="mt-4 text-primary hover:underline"
          >
            点击下载查看
          </a>
        </div>

        <div
          class="flex justify-end gap-3 w-full mt-4 pt-4 border-t border-gray-100"
        >
          <NButton type="primary" @click="handleClose"> 关闭 </NButton>
          <a
            :href="previewUrl()"
            target="_blank"
            download
            class="inline-flex items-center px-4 py-2 bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            下载文件
          </a>
        </div>
      </template>

      <template v-if="loadError">
        <NAlert type="error" :description="errorMessage" closable class="mb-4">
          文档加载失败
        </NAlert>

        <div class="flex flex-col items-center justify-center py-8">
          <NIcon size="48" class="text-red-400 mb-4">
            <DocumentTextOutline />
          </NIcon>
          <p class="text-gray-500 mb-4">无法加载文档</p>
          <NButton type="primary" @click="handleReload"> 重新加载 </NButton>
        </div>

        <div
          class="flex justify-end gap-3 w-full mt-4 pt-4 border-t border-gray-100"
        >
          <NButton type="primary" @click="handleClose"> 关闭 </NButton>
        </div>
      </template>
    </div>
  </NModal>
</template>
