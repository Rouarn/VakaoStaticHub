<script setup lang="ts">
import { computed, ref } from 'vue';
import { NIcon } from 'naive-ui';
import {
  ContractOutline,
  ExpandOutline,
  PauseOutline,
  PlayOutline,
  VolumeHighOutline,
  VolumeMuteOutline,
} from '@vicons/ionicons5';
import { formatDuration } from '@/utils/file-types';

/**
 * 媒体控制条（audio-preview / video-preview 共用）
 *
 * 只负责展示与交互，不持有 media 元素：播放状态由调用方从原生事件同步进来，
 * 交互以事件抛出，保证音频与视频两处控件完全同构（同一套间距/配色/焦点样式）。
 */
const props = withDefaults(
  defineProps<{
    playing: boolean;
    /** 当前播放秒数 */
    current: number;
    /** 总时长（秒），未知时为 0 */
    duration: number;
    /** 已缓冲到的秒数 */
    buffered: number;
    muted: boolean;
    fullscreen?: boolean;
    showFullscreen?: boolean;
    /** 仅在空间充足时展示，窄屏隐藏以免溢出 */
    filename?: string;
  }>(),
  { fullscreen: false, showFullscreen: true, filename: '' },
);

const emit = defineEmits<{
  toggle: [];
  seek: [seconds: number];
  mute: [];
  fullscreen: [];
}>();

const trackEl = ref<HTMLElement | null>(null);
/** 拖动中的临时位置：远端 seek 的 timeupdate 有延迟，直接用它会回跳 */
const dragging = ref(false);
const dragValue = ref(0);

const safeDuration = computed(() =>
  Number.isFinite(props.duration) && props.duration > 0 ? props.duration : 0,
);
const shownCurrent = computed(() =>
  dragging.value ? dragValue.value : props.current,
);
const playedPct = computed(() =>
  safeDuration.value
    ? Math.min(100, (shownCurrent.value / safeDuration.value) * 100)
    : 0,
);
const bufferedPct = computed(() => {
  if (!safeDuration.value) return 0;
  const end = Math.max(props.buffered, shownCurrent.value);
  return Math.min(100, (end / safeDuration.value) * 100);
});

function seekTo(seconds: number) {
  if (!safeDuration.value) return;
  const value = Math.min(safeDuration.value, Math.max(0, seconds));
  dragValue.value = value;
  emit('seek', value);
}

function pctAt(clientX: number): number {
  const rect = trackEl.value?.getBoundingClientRect();
  if (!rect || rect.width === 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function onPointerDown(e: PointerEvent) {
  if (!safeDuration.value) return;
  dragging.value = true;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  } catch {
    // 指针已释放时 setPointerCapture 会抛错，忽略即可继续拖动
  }
  seekTo(pctAt(e.clientX) * safeDuration.value);
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  seekTo(pctAt(e.clientX) * safeDuration.value);
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  try {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  } catch {
    // 同上：捕获可能已随指针结束自动释放
  }
}

function onTrackKeydown(e: KeyboardEvent) {
  if (!safeDuration.value) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    seekTo(props.current + (e.key === 'ArrowRight' ? 5 : -5));
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    e.stopPropagation();
    seekTo(e.key === 'Home' ? 0 : safeDuration.value);
  }
}
</script>

<template>
  <div class="w-full min-w-0">
    <!-- 44px 触控高度，视觉仍是 6px 细轨 -->
    <div
      ref="trackEl"
      class="h-11 flex items-center cursor-pointer select-none touch-none rounded-full focus-ring"
      role="slider"
      tabindex="0"
      aria-label="播放进度"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(safeDuration)"
      :aria-valuenow="Math.round(shownCurrent)"
      :aria-valuetext="`${formatDuration(shownCurrent)} / ${formatDuration(safeDuration)}`"
      :aria-disabled="safeDuration === 0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @keydown="onTrackKeydown"
    >
      <div class="media-track">
        <div
          class="absolute inset-y-0 left-0 rounded-full bg-brand-500/30"
          :style="{ width: `${bufferedPct}%` }"
        />
        <div
          class="absolute inset-y-0 left-0 rounded-full bg-brand-500"
          :style="{ width: `${playedPct}%` }"
        />
      </div>
    </div>

    <div class="flex items-center gap-1.5 sm:gap-3">
      <button
        type="button"
        class="media-btn-primary"
        :aria-label="playing ? '暂停' : '播放'"
        @click="emit('toggle')"
      >
        <NIcon :size="20">
          <PauseOutline v-if="playing" />
          <PlayOutline v-else />
        </NIcon>
      </button>

      <span class="text-12px text-ink-sub tabular-nums shrink-0">
        {{ formatDuration(shownCurrent) }} / {{ formatDuration(safeDuration) }}
      </span>

      <span
        v-if="filename"
        class="ml-auto hidden sm:block text-12px text-ink-sub truncate min-w-0"
      >
        {{ filename }}
      </span>

      <div class="ml-auto sm:ml-0 flex items-center gap-1 shrink-0">
        <button
          type="button"
          class="media-btn"
          :aria-label="muted ? '取消静音' : '静音'"
          :aria-pressed="muted"
          @click="emit('mute')"
        >
          <NIcon :size="18">
            <VolumeMuteOutline v-if="muted" />
            <VolumeHighOutline v-else />
          </NIcon>
        </button>
        <button
          v-if="showFullscreen"
          type="button"
          class="media-btn"
          :aria-label="fullscreen ? '退出全屏' : '全屏'"
          :aria-pressed="fullscreen"
          @click="emit('fullscreen')"
        >
          <NIcon :size="18">
            <ContractOutline v-if="fullscreen" />
            <ExpandOutline v-else />
          </NIcon>
        </button>
      </div>
    </div>
  </div>
</template>
