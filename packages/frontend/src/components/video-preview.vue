<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { NSpin } from 'naive-ui';
import {
  loadVideoPlayer,
  type VideoJsPlayer,
} from '@/utils/video-player-loader';
import { getVideoMimeType } from '@/utils/file-types';

interface Props {
  /** 视频文件直链（后端已支持 Range，边下边播） */
  src: string;
  /** 用于推断 MIME 类型的文件名，缺省时从 src 路径推断 */
  filename?: string;
}

interface Emits {
  (e: 'ready'): void;
  (e: 'load'): void;
  (e: 'error', error: Error): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** video.js MediaError.code（对齐 W3C MEDIA_ERR_*）对应的中文错误信息 */
const VIDEO_ERROR_MESSAGES: Record<number, string> = {
  1: '视频加载被中止',
  2: '网络错误，视频加载失败',
  3: '视频解码失败，编码格式可能不受支持',
  4: '视频格式不受支持或文件不存在',
};

const videoEl = ref<HTMLVideoElement | null>(null);
const loading = ref(true);
let player: VideoJsPlayer | null = null;
// 异步加载与 src 切换的竞态守卫：每次初始化递增，回调时校验
let initGeneration = 0;

const resolveFilename = () => {
  if (props.filename) return props.filename;
  try {
    return new URL(props.src).pathname.split('/').pop() || props.src;
  } catch {
    return props.src;
  }
};

const destroyPlayer = () => {
  if (player) {
    player.dispose();
    player = null;
  }
};

const initPlayer = async () => {
  if (!videoEl.value || !props.src) return;

  destroyPlayer();
  loading.value = true;
  const generation = ++initGeneration;

  try {
    const videojs = await loadVideoPlayer();
    // 等待期间组件已卸载或 src 已切换，放弃本次初始化
    if (generation !== initGeneration || !videoEl.value) return;

    player = videojs(videoEl.value, {
      controls: true,
      preload: 'auto',
      // 填满父容器（父级 .video-preview 为 w-full h-full，尺寸由外层确定），
      // 不用 fluid：否则 video.js 会按默认 300x150 或宽高比重算内联尺寸
      fill: true,
      // 错误统一走 emit('error') 由外层展示，关闭播放器内置错误浮层
      errorDisplay: false,
      sources: [{ src: props.src, type: getVideoMimeType(resolveFilename()) }],
    });

    player.ready(() => {
      if (generation !== initGeneration) return;
      emit('ready');
    });

    player.one('loadedmetadata', () => {
      if (generation !== initGeneration) return;
      loading.value = false;
      emit('load');
    });

    player.on('error', () => {
      if (generation !== initGeneration) return;
      loading.value = false;
      const mediaError = player?.error();
      const message =
        (mediaError?.code && VIDEO_ERROR_MESSAGES[mediaError.code]) ||
        mediaError?.message ||
        '视频加载失败';
      emit('error', new Error(message));
    });
  } catch (error) {
    if (generation !== initGeneration) return;
    loading.value = false;
    emit(
      'error',
      error instanceof Error ? error : new Error('初始化视频播放器失败'),
    );
  }
};

onMounted(initPlayer);

watch(
  () => props.src,
  (src, oldSrc) => {
    if (src && src !== oldSrc) {
      initPlayer();
    }
  },
);

onUnmounted(() => {
  initGeneration++;
  destroyPlayer();
});

defineExpose({
  reload: initPlayer,
  destroy: destroyPlayer,
});
</script>

<template>
  <div
    class="video-preview relative w-full h-full flex items-center justify-center bg-black overflow-hidden"
  >
    <video
      ref="videoEl"
      class="video-js vjs-big-play-centered w-full h-full"
      playsinline
      webkit-playsinline
    />
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>
