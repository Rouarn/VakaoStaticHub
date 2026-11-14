<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NButton, NIcon } from 'naive-ui';
import {
  AlertCircleOutline,
  DownloadOutline,
  RefreshOutline,
} from '@vicons/ionicons5';
import type { PreviewProps } from './types';
import MediaControls from './media-controls.vue';
import { watchMediaCsp } from './media-csp';

/**
 * 视频预览：原生 <video> + 自定义控制条（与 audio-preview 共用 media-controls）
 *
 * - 保留 preload="metadata" / playsinline / 不自动播放，依赖服务端 Range 边下边播
 * - 加载中、加载失败、编码不支持、CSP 拦截分别给出准确提示与重试/下载动作
 */
const props = defineProps<PreviewProps>();

type ErrorKind = 'csp' | 'decode' | 'network';

const shellEl = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
const playing = ref(false);
const current = ref(0);
const duration = ref(0);
const buffered = ref(0);
const muted = ref(false);
const fullscreen = ref(false);
/** 是否已出首帧：区分「首次加载」与「播放中缓冲」 */
const presenting = ref(false);
const buffering = ref(false);
const errorKind = ref<ErrorKind | null>(null);
/** CSP 拦截会同时触发 error 事件，用它避免被误判成编码问题 */
const cspBlocked = ref(false);

const loading = computed(
  () => !errorKind.value && (!presenting.value || buffering.value),
);
const loadingText = computed(() => (presenting.value ? '缓冲中…' : '加载中…'));
const errorTitle = computed(() => {
  switch (errorKind.value) {
    case 'csp':
      return '媒体被页面安全策略拦截';
    case 'decode':
      return '当前浏览器无法解码该视频编码';
    default:
      return '视频加载失败';
  }
});
const errorHint = computed(() => {
  switch (errorKind.value) {
    case 'csp':
      return '当前页面的 CSP 未允许该媒体地址，播放器无法发起加载；这通常是服务端安全头缺少 media-src 导致。';
    case 'decode':
      return '常见于 H.265/HEVC、AV1 或 MKV 封装，浏览器无法解码时可下载后用本地播放器打开。';
    default:
      return '请确认文件地址可访问、网络正常，然后重试。';
  }
});

function toggle() {
  const el = videoEl.value;
  if (!el || errorKind.value) return;
  if (el.paused) {
    // 只响应用户手势，不自动播放
    void el.play().catch(() => {
      buffering.value = false;
    });
  } else {
    el.pause();
  }
}

function seek(seconds: number) {
  const el = videoEl.value;
  if (!el) return;
  const max = Number.isFinite(el.duration) ? el.duration : seconds;
  const value = Math.min(Math.max(0, seconds), max);
  el.currentTime = value;
  // 立即回填，避免远端 seek 的 timeupdate 延迟导致进度条回跳
  current.value = value;
}

function toggleMute() {
  const el = videoEl.value;
  if (!el) return;
  el.muted = !el.muted;
}

function syncBuffered() {
  const el = videoEl.value;
  if (!el || el.buffered.length === 0) return;
  buffered.value = el.buffered.end(el.buffered.length - 1);
}

function onTimeUpdate() {
  const el = videoEl.value;
  if (!el) return;
  current.value = el.currentTime;
  syncBuffered();
}

function onDurationChange() {
  const el = videoEl.value;
  if (!el) return;
  duration.value = Number.isFinite(el.duration) ? el.duration : 0;
}

function onLoadedData() {
  presenting.value = true;
  buffering.value = false;
}

function onWaiting() {
  if (playing.value) buffering.value = true;
}

function onPlaying() {
  buffering.value = false;
}

function onVolumeChange() {
  muted.value = videoEl.value?.muted ?? false;
}

function onError() {
  const code = videoEl.value?.error?.code ?? 0;
  // 3 = MEDIA_ERR_DECODE，4 = MEDIA_ERR_SRC_NOT_SUPPORTED
  errorKind.value = cspBlocked.value
    ? 'csp'
    : code === 3 || code === 4
      ? 'decode'
      : 'network';
  playing.value = false;
  buffering.value = false;
}

function retry() {
  const el = videoEl.value;
  errorKind.value = null;
  cspBlocked.value = false;
  presenting.value = false;
  buffering.value = false;
  current.value = 0;
  duration.value = 0;
  buffered.value = 0;
  el?.load();
}

function toggleFullscreen() {
  const shell = shellEl.value;
  const video = videoEl.value as
    (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  if (!shell) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
    return;
  }
  if (shell.requestFullscreen) {
    void shell
      .requestFullscreen()
      .catch(() => video?.webkitEnterFullscreen?.());
  } else {
    // iOS Safari 不支持任意元素全屏，退回原生视频全屏
    video?.webkitEnterFullscreen?.();
  }
}

function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === shellEl.value;
}

function onShellKeydown(e: KeyboardEvent) {
  // 只在容器自身获得焦点时处理，避免和按钮/进度条的原生按键重复触发
  if (e.target !== shellEl.value) return;
  if (e.code === 'Space') {
    e.preventDefault();
    toggle();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    seek(current.value + (e.key === 'ArrowRight' ? 5 : -5));
  }
}

function onCspBlocked() {
  cspBlocked.value = true;
  errorKind.value = 'csp';
  playing.value = false;
  buffering.value = false;
}

let stopCspWatch: (() => void) | null = null;

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  stopCspWatch = watchMediaCsp(() => props.src, onCspBlocked);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  stopCspWatch?.();
  videoEl.value?.pause();
});
</script>

<template>
  <div
    class="w-full h-full flex items-center justify-center p-2 sm:p-3 box-border"
  >
    <div
      ref="shellEl"
      class="w-full h-full flex flex-col glass-card overflow-hidden bg-gradient-to-br from-brand-500/15 via-transparent to-brand-700/10 focus-ring"
      :class="fullscreen ? 'max-w-none rounded-none border-none' : 'max-w-5xl'"
      tabindex="0"
      role="region"
      aria-label="视频播放器（空格播放暂停，左右方向键快退快进）"
      @keydown="onShellKeydown"
    >
      <div
        class="relative flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden"
      >
        <video
          ref="videoEl"
          v-show="!errorKind"
          :src="props.src"
          class="w-full h-full max-w-full max-h-full object-contain"
          preload="metadata"
          playsinline
          @click="toggle"
          @play="playing = true"
          @pause="playing = false"
          @timeupdate="onTimeUpdate"
          @durationchange="onDurationChange"
          @progress="syncBuffered"
          @loadeddata="onLoadedData"
          @waiting="onWaiting"
          @playing="onPlaying"
          @volumechange="onVolumeChange"
          @error="onError"
        />

        <div
          v-if="loading"
          class="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <span class="glass-chip px-3 py-1 text-12px text-ink-sub">
            {{ loadingText }}
          </span>
        </div>

        <div
          v-if="errorKind"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 py-8 text-center bg-[var(--mat-panel-strong)] box-border"
        >
          <NIcon :size="30" class="text-ink-sub">
            <AlertCircleOutline />
          </NIcon>
          <p class="m-0 text-13px font-600 text-ink">{{ errorTitle }}</p>
          <p class="m-0 text-12px text-ink-sub max-w-110">{{ errorHint }}</p>
          <div class="mt-2 flex items-center gap-2">
            <NButton size="small" type="primary" @click="retry">
              <template #icon>
                <NIcon><RefreshOutline /></NIcon>
              </template>
              重试
            </NButton>
            <NButton
              v-if="props.downloadSrc"
              tag="a"
              :href="props.downloadSrc"
              download
              size="small"
            >
              <template #icon>
                <NIcon><DownloadOutline /></NIcon>
              </template>
              下载文件
            </NButton>
          </div>
        </div>
      </div>

      <div
        v-if="!errorKind"
        class="shrink-0 px-3 pt-1 pb-2 sm:px-5 sm:pt-2 sm:pb-3"
      >
        <MediaControls
          :playing="playing"
          :current="current"
          :duration="duration"
          :buffered="buffered"
          :muted="muted"
          :fullscreen="fullscreen"
          @toggle="toggle"
          @seek="seek"
          @mute="toggleMute"
          @fullscreen="toggleFullscreen"
        />
      </div>
    </div>
  </div>
</template>
