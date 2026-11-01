<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent } from 'vue';
import { NIcon, NModal, NAlert, NButton } from 'naive-ui';
import {
  DocumentTextOutline,
  PlayCircleOutline,
  VideocamOutline,
  MusicalNoteOutline,
} from '@vicons/ionicons5';
import { prefetchVideoPlayer } from '@/utils/video-player-loader';
import { resolvePreview, prefetchPreview } from '@/utils/preview-registry';
import { isVideo, isAudio, isPptExternal } from '@/utils/file-types';

interface Props {
  filePath: string;
  fileUrl: (path: string) => string;
}

const props = defineProps<Props>();

const showModal = ref(false);
const loadError = ref(false);
const errorMessage = ref('');

// 注册表分发：每种可预览类型对应一个懒加载组件（点击时才拉取对应 chunk）
const resolution = resolvePreview(props.filePath);
const AsyncPreview =
  resolution.kind === 'component'
    ? defineAsyncComponent(resolution.loader)
    : null;

// 视频/音频卡面有专属形态（视频首帧缩略图/音频图标）
const isVideoFile = computed(() => isVideo(props.filePath));
const isAudioFile = computed(() => isAudio(props.filePath));
// 出错重试：通过 key 重建预览组件
const reloadKey = ref(0);

// 视频首帧缩略图加载失败（如 mkv/avi 浏览器无法解码）时回退为摄像机图标
const thumbError = ref(false);

const onThumbLoaded = (e: Event) => {
  // 部分浏览器 preload="metadata" 不主动绘制首帧，微推进度确保画面可见；
  // 后端已支持 Range，此次 seek 只产生一个小的分片请求
  const video = e.target as HTMLVideoElement;
  if (video.duration > 0.1) {
    video.currentTime = 0.1;
  }
};

const previewUrl = () => props.fileUrl(props.filePath);

const handleClick = () => {
  // PPT 浏览器无内建渲染器：新标签打开，浏览器自动触发下载
  if (isPptExternal(props.filePath)) {
    window.open(previewUrl(), '_blank');
    return;
  }

  if (!AsyncPreview) return;

  showModal.value = true;
  loadError.value = false;
  errorMessage.value = '';
};

const handlePreviewError = (err: Error) => {
  loadError.value = true;
  errorMessage.value = err.message || '加载失败';
};

const handleClose = () => {
  showModal.value = false;
};

const handleReload = () => {
  loadError.value = false;
  errorMessage.value = '';
  reloadKey.value++;
};

// 卡片渲染后趁浏览器空闲预取，首次点击预览时几乎无等待
onMounted(() => {
  if (isVideoFile.value) {
    // video.js 体积较大，单独预取（音频用原生元素，无需预取）
    prefetchVideoPlayer();
  }
  if (AsyncPreview && !isAudioFile.value) {
    prefetchPreview(props.filePath);
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
    <template v-if="isVideoFile">
      <div v-if="!thumbError" class="relative w-full h-full bg-black">
        <!-- 首帧即缩略图：preload="metadata" 只拉取元数据与首个分片 -->
        <video
          :src="previewUrl()"
          class="w-full h-full object-cover"
          muted
          playsinline
          preload="metadata"
          @loadedmetadata="onThumbLoaded"
          @error="thumbError = true"
        />
        <div
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <NIcon
            size="30"
            class="text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
          >
            <PlayCircleOutline />
          </NIcon>
        </div>
      </div>
      <NIcon v-else size="32" class="text-gray-400">
        <VideocamOutline />
      </NIcon>
    </template>
    <NIcon v-else-if="isAudioFile" size="32" class="text-gray-400">
      <MusicalNoteOutline />
    </NIcon>
    <NIcon v-else size="32" class="text-gray-400">
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
        v-if="AsyncPreview"
        class="w-[80vw] max-w-4xl h-[75vh] mx-auto p-3 flex items-center justify-center bg-container rounded-xl overflow-hidden relative"
      >
        <component
          :is="AsyncPreview"
          :key="reloadKey"
          :src="previewUrl()"
          :filename="filePath"
          @error="handlePreviewError"
        />
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
          加载失败
        </NAlert>

        <div class="flex flex-col items-center justify-center py-8">
          <NIcon size="48" class="text-red-400 mb-4">
            <DocumentTextOutline />
          </NIcon>
          <p class="text-gray-500 mb-4">无法加载文件</p>
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
