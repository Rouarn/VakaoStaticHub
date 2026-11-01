<script setup lang="ts">
import { ref, computed, onUnmounted, watch } from 'vue';
import { NIcon, NSpin, NButton, NSlider } from 'naive-ui';
import {
  MusicalNotesOutline,
  PlayOutline,
  PauseOutline,
  VolumeHighOutline,
  VolumeMuteOutline,
} from '@vicons/ionicons5';

interface Props {
  /** 音频文件直链（后端已支持 Range，边下边播） */
  src: string;
  /** 展示用文件名 */
  filename?: string;
}

interface Emits {
  (e: 'ready'): void;
  (e: 'load'): void;
  (e: 'error', error: Error): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

/** HTMLMediaElement.error.code（W3C MEDIA_ERR_*）对应的中文错误信息 */
const AUDIO_ERROR_MESSAGES: Record<number, string> = {
  1: '音频加载被中止',
  2: '网络错误，音频加载失败',
  3: '音频解码失败，编码格式可能不受支持',
  4: '音频格式不受支持或文件不存在',
};

const audioEl = ref<HTMLAudioElement | null>(null);
const loading = ref(true);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const bufferedEnd = ref(0);
const volume = ref(1);
const muted = ref(false);

const playedPercent = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0,
);
const bufferedPercent = computed(() =>
  duration.value > 0 ? Math.min(100, (bufferedEnd.value / duration.value) * 100) : 0,
);

const displayName = computed(() => {
  const raw = props.filename || props.src;
  try {
    return decodeURIComponent(raw.split('/').pop() || raw);
  } catch {
    return raw;
  }
});

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const onLoaded = () => {
  loading.value = false;
  duration.value = audioEl.value?.duration || 0;
  volume.value = audioEl.value?.volume ?? 1;
  emit('load');
};

const onCanPlay = () => {
  emit('ready');
};

const onTimeUpdate = () => {
  currentTime.value = audioEl.value?.currentTime || 0;
};

const onProgress = () => {
  const a = audioEl.value;
  if (a && a.buffered.length > 0) {
    bufferedEnd.value = a.buffered.end(a.buffered.length - 1);
  }
};

const onError = () => {
  loading.value = false;
  playing.value = false;
  const mediaError = audioEl.value?.error;
  const message =
    (mediaError?.code && AUDIO_ERROR_MESSAGES[mediaError.code]) ||
    '音频加载失败';
  emit('error', new Error(message));
};

const togglePlay = () => {
  const a = audioEl.value;
  if (!a) return;
  if (a.paused) {
    a.play().catch(() => {});
  } else {
    a.pause();
  }
};

const onSeek = (e: MouseEvent) => {
  const a = audioEl.value;
  if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
  const track = e.currentTarget as HTMLElement;
  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  a.currentTime = ratio * a.duration;
};

const onVolumeChange = (v: number) => {
  const a = audioEl.value;
  if (!a) return;
  a.volume = v;
  a.muted = false;
  volume.value = v;
  muted.value = false;
};

/** 同步元素侧音量变化（如浏览器快捷键、toggleMute）到滑块状态 */
const onVolumeSync = () => {
  const a = audioEl.value;
  if (!a) return;
  volume.value = a.volume;
  muted.value = a.muted;
};

const toggleMute = () => {
  const a = audioEl.value;
  if (!a) return;
  a.muted = !a.muted;
  muted.value = a.muted;
};

const reload = () => {
  if (!audioEl.value) return;
  loading.value = true;
  playing.value = false;
  currentTime.value = 0;
  bufferedEnd.value = 0;
  audioEl.value.load();
};

const destroy = () => {
  audioEl.value?.pause();
};

watch(
  () => props.src,
  () => {
    // :src 绑定会自动更新元素，这里只需重置状态并触发重新加载
    reload();
  },
);

onUnmounted(destroy);

defineExpose({ reload, destroy });
</script>

<template>
  <div
    class="audio-preview relative w-full h-full flex flex-col items-center justify-center gap-8 px-8"
  >
    <!-- 隐藏的原生 audio 负责流式播放（Range），控制条完全自绘 -->
    <audio
      ref="audioEl"
      preload="metadata"
      :src="src"
      @loadedmetadata="onLoaded"
      @canplay="onCanPlay"
      @timeupdate="onTimeUpdate"
      @progress="onProgress"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @volumechange="onVolumeSync"
      @error="onError"
    />

    <!-- 封面徽章：播放时呼吸律动 -->
    <div class="relative flex items-center justify-center">
      <div
        class="absolute inset-0 rounded-full bg-primary/20"
        :class="{ 'animate-ping-slow': playing }"
      />
      <div
        class="relative w-28 h-28 rounded-full bg-primary/10 dark:bg-primary/15 flex items-center justify-center"
      >
        <NIcon size="52" class="text-primary">
          <MusicalNotesOutline />
        </NIcon>
      </div>
      <!-- 律动条 -->
      <div v-if="playing" class="absolute -bottom-5 flex items-end gap-1 h-4">
        <span
          v-for="i in 5"
          :key="i"
          class="eq-bar w-1 rounded-full bg-primary"
          :style="{ animationDelay: `${(i - 1) * 0.12}s` }"
        />
      </div>
    </div>

    <div
      class="text-base text-gray-700 dark:text-gray-200 break-all text-center max-w-full"
    >
      {{ displayName }}
    </div>

    <!-- 进度条：底层缓冲、上层已播、点击跳转（外层扩点击热区，内层统一坐标系） -->
    <div class="w-full max-w-xl">
      <div class="group cursor-pointer py-2" @click="onSeek">
        <div
          class="relative h-1.5 rounded-full bg-gray-200 dark:bg-gray-700"
        >
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-gray-300 dark:bg-gray-600 transition-[width] duration-300"
            :style="{ width: `${bufferedPercent}%` }"
          />
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-primary"
            :style="{ width: `${playedPercent}%` }"
          />
          <div
            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-primary shadow opacity-0 group-hover:opacity-100 transition-opacity"
            :style="{ left: `${playedPercent}%` }"
          />
        </div>
      </div>
      <div
        class="flex justify-between mt-2 text-xs text-gray-500 dark:text-gray-400 tabular-nums"
      >
        <span>{{ formatTime(currentTime) }}</span>
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>

    <!-- 控制区：播放/暂停 + 音量 -->
    <div class="flex items-center gap-6">
      <NButton circle size="large" type="primary" @click="togglePlay">
        <template #icon>
          <NIcon size="22">
            <PauseOutline v-if="playing" />
            <PlayOutline v-else />
          </NIcon>
        </template>
      </NButton>
      <div class="flex items-center gap-2">
        <NIcon
          size="20"
          class="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-primary transition-colors"
          @click="toggleMute"
        >
          <VolumeMuteOutline v-if="muted || volume === 0" />
          <VolumeHighOutline v-else />
        </NIcon>
        <NSlider
          :value="muted ? 0 : volume"
          :min="0"
          :max="1"
          :step="0.01"
          :tooltip="false"
          class="w-24"
          @update:value="onVolumeChange"
        />
      </div>
    </div>

    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none bg-container/60"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>

<style scoped>
.eq-bar {
  height: 100%;
  animation: eq-bounce 0.9s ease-in-out infinite alternate;
}

@keyframes eq-bounce {
  from {
    transform: scaleY(0.25);
  }
  to {
    transform: scaleY(1);
  }
}

.animate-ping-slow {
  animation: ping-slow 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}

@keyframes ping-slow {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }
  80%,
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}
</style>
