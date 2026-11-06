<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { NIcon } from 'naive-ui';
import { PlayOutline, PauseOutline } from '@vicons/ionicons5';
import type { PreviewProps } from './types';
import { formatDuration } from '@/utils/file-types';

/**
 * 音频预览：渐变底 + 波形 + 播放控制
 * 波形由文件名确定性生成（不额外解码音频），时间/进度取自 audio 事件
 */
const props = defineProps<PreviewProps>();

const audioEl = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const current = ref(0);
const duration = ref(0);
const failed = ref(false);

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
  if (!el) return;
  if (el.paused) void el.play();
  else el.pause();
}

function onTime() {
  current.value = audioEl.value?.currentTime ?? 0;
}

function onMeta() {
  duration.value = audioEl.value?.duration ?? 0;
}

function seek(e: MouseEvent) {
  const el = audioEl.value;
  if (!el || !duration.value) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  el.currentTime = ((e.clientX - rect.left) / rect.width) * duration.value;
}

onMounted(() => {
  const el = audioEl.value;
  if (!el) return;
  el.addEventListener('play', () => (playing.value = true));
  el.addEventListener('pause', () => (playing.value = false));
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('loadedmetadata', onMeta);
});
onBeforeUnmount(() => {
  audioEl.value?.pause();
});
</script>

<template>
  <div class="w-full h-full flex items-center justify-center">
    <div class="w-full max-w-140">
      <p v-if="failed" class="text-center text-ink-sub text-13px">
        音频加载失败
      </p>
      <template v-else>
        <div
          class="glass-card px-6 py-6 bg-gradient-to-br from-brand-500/15 via-transparent to-brand-700/10"
        >
          <div class="flex items-end gap-[2px] h-16 mb-4 px-1">
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

          <div
            class="h-1.5 rounded-full bg-white/40 dark:bg-white/10 cursor-pointer mb-3"
            @click="seek"
          >
            <div
              class="h-full rounded-full bg-brand-500"
              :style="{
                width: `${duration ? (current / duration) * 100 : 0}%`,
              }"
            />
          </div>

          <div class="flex items-center gap-3">
            <button
              class="w-10 h-10 rounded-full flex items-center justify-center border-none cursor-pointer bg-brand-600 text-white"
              @click="toggle"
            >
              <NIcon :size="20">
                <PauseOutline v-if="playing" />
                <PlayOutline v-else />
              </NIcon>
            </button>
            <span class="text-12px text-ink-sub">
              {{ formatDuration(current) }} / {{ formatDuration(duration) }}
            </span>
            <span class="ml-auto text-12px text-ink-sub truncate max-w-60">
              {{ props.filename }}
            </span>
          </div>
        </div>
        <audio
          ref="audioEl"
          :src="props.src"
          preload="metadata"
          @error="failed = true"
        />
      </template>
    </div>
  </div>
</template>
