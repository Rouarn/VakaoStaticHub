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
 * 音频预览：渐变底 + 波形 + 播放控制
 * 波形由文件名确定性生成（不额外解码音频），时间/进度/缓冲取自 audio 事件；
 * 控制条与 video-preview 共用 media-controls，两处外观保持一致
 */
const props = defineProps<PreviewProps>();

const audioEl = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const current = ref(0);
const duration = ref(0);
const buffered = ref(0);
const muted = ref(false);
const loaded = ref(false);
const failed = ref(false);
/** CSP 拦截会同时触发 error 事件，用它避免被误判成编码问题 */
const cspBlocked = ref(false);

const errorHint = computed(() =>
  cspBlocked.value
    ? '当前页面的 CSP 未允许该音频地址，播放器无法发起加载。'
    : '请确认文件地址可访问、网络正常，然后重试。',
);

/** 确定性伪波形：按文件名哈希生成 48 根柱子的高度 */
const bars = Array.from({ length: 48 }, (_, i) => {
  let h = 0;
  const name = props.filename;
  for (let c = 0; c < name.length; c++) h = (h * 31 + name.charCodeAt(c)) % 997;
  const wave = Math.sin((i / 48) * Math.PI) * 0.6 + 0.4;
  return 18 + ((h + i * 37) % 100) * 0.55 * wave;
});

function toggle() {
  const el = audioEl.value;
  if (!el || failed.value) return;
  if (el.paused) void el.play().catch(() => undefined);
  else el.pause();
}

function seek(seconds: number) {
  const el = audioEl.value;
  if (!el) return;
  el.currentTime = seconds;
  current.value = seconds;
}

function toggleMute() {
  const el = audioEl.value;
  if (!el) return;
  el.muted = !el.muted;
}

function syncBuffered() {
  const el = audioEl.value;
  if (!el || el.buffered.length === 0) return;
  buffered.value = el.buffered.end(el.buffered.length - 1);
}

function onTimeUpdate() {
  const el = audioEl.value;
  if (!el) return;
  current.value = el.currentTime;
  syncBuffered();
}

function onDurationChange() {
  const el = audioEl.value;
  if (!el) return;
  duration.value = Number.isFinite(el.duration) ? el.duration : 0;
  loaded.value = true;
}

function onError() {
  failed.value = true;
  playing.value = false;
}

function retry() {
  const el = audioEl.value;
  failed.value = false;
  cspBlocked.value = false;
  loaded.value = false;
  current.value = 0;
  duration.value = 0;
  buffered.value = 0;
  el?.load();
}

function onCspBlocked() {
  cspBlocked.value = true;
  failed.value = true;
  playing.value = false;
}

let stopCspWatch: (() => void) | null = null;

onMounted(() => {
  stopCspWatch = watchMediaCsp(() => props.src, onCspBlocked);
});

onBeforeUnmount(() => {
  stopCspWatch?.();
  audioEl.value?.pause();
});
</script>

<template>
  <div class="w-full h-full flex items-center justify-center p-2 sm:p-3 box-border">
    <div class="w-full max-w-140">
      <div
        v-if="failed"
        class="glass-card px-6 py-8 flex flex-col items-center gap-2 text-center"
      >
        <NIcon :size="30" class="text-ink-sub">
          <AlertCircleOutline />
        </NIcon>
        <p class="m-0 text-13px font-600 text-ink">音频加载失败</p>
        <p class="m-0 text-12px text-ink-sub">{{ errorHint }}</p>
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

      <div
        v-else
        class="glass-card px-6 py-6 bg-gradient-to-br from-brand-500/15 via-transparent to-brand-700/10"
      >
        <div class="flex items-end gap-[2px] h-16 mb-2 px-1">
          <span
            v-for="(h, i) in bars"
            :key="i"
            class="flex-1 rounded-sm bg-brand-500/70 transition-all duration-300"
            :style="{
              height: `${h}%`,
              opacity: i / 48 < current / (duration || 1) ? 1 : 0.35,
            }"
          />
        </div>

        <div v-if="!loaded" class="mb-1 text-12px text-ink-sub">加载中…</div>

        <MediaControls
          :playing="playing"
          :current="current"
          :duration="duration"
          :buffered="buffered"
          :muted="muted"
          :show-fullscreen="false"
          :filename="props.filename"
          @toggle="toggle"
          @seek="seek"
          @mute="toggleMute"
        />
      </div>

      <audio
        ref="audioEl"
        v-show="false"
        :src="props.src"
        preload="metadata"
        @play="playing = true"
        @pause="playing = false"
        @timeupdate="onTimeUpdate"
        @durationchange="onDurationChange"
        @progress="syncBuffered"
        @volumechange="muted = audioEl?.muted ?? false"
        @error="onError"
      />
    </div>
  </div>
</template>
