<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NIcon, NTooltip } from 'naive-ui';
import {
  AddOutline,
  RemoveOutline,
  RefreshOutline,
  ContractOutline,
} from '@vicons/ionicons5';
import type { PreviewProps } from './types';

/**
 * 图片预览：缩放（滚轮/按钮）、旋转、适应屏幕、拖拽平移
 * 缩放与旋转只作用于 transform，不改动布局，避免 1px 抖动
 */
const props = defineProps<PreviewProps>();

const scale = ref(1);
const rotate = ref(0);
const tx = ref(0);
const ty = ref(0);
const failed = ref(false);

function zoom(delta: number) {
  scale.value = Math.min(8, Math.max(0.1, scale.value + delta));
}

function onWheel(e: WheelEvent) {
  zoom(e.deltaY < 0 ? 0.15 : -0.15);
}

function reset() {
  scale.value = 1;
  rotate.value = 0;
  tx.value = 0;
  ty.value = 0;
}

let dragging = false;
let startX = 0;
let startY = 0;

function onPointerDown(e: PointerEvent) {
  dragging = true;
  startX = e.clientX - tx.value;
  startY = e.clientY - ty.value;
  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return;
  tx.value = e.clientX - startX;
  ty.value = e.clientY - startY;
}
function onPointerUp() {
  dragging = false;
}
</script>

<template>
  <div class="relative w-full h-full flex flex-col">
    <div
      class="flex-1 min-h-0 flex items-center justify-center overflow-hidden"
    >
      <div v-if="failed" class="text-ink-sub text-13px">图片加载失败</div>
      <img
        v-else
        :src="props.src"
        :alt="props.filename"
        class="max-w-full max-h-full select-none will-change-transform cursor-grab"
        :style="{
          transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rotate}deg)`,
        }"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @error="failed = true"
      />
    </div>

    <div class="mt-3 flex justify-center">
      <div class="glass-chip flex items-center gap-1 px-2 py-1">
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton size="tiny" quaternary circle @click="zoom(-0.2)">
              <template #icon
                ><NIcon :size="16"><RemoveOutline /></NIcon
              ></template>
            </NButton> </template
          >缩小</NTooltip
        >
        <span class="text-12px text-ink-sub w-12 text-center">
          {{ Math.round(scale * 100) }}%
        </span>
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton size="tiny" quaternary circle @click="zoom(0.2)">
              <template #icon
                ><NIcon :size="16"><AddOutline /></NIcon
              ></template>
            </NButton> </template
          >放大</NTooltip
        >
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton size="tiny" quaternary circle @click="rotate += 90">
              <template #icon
                ><NIcon :size="16"><RefreshOutline /></NIcon
              ></template>
            </NButton> </template
          >旋转 90°</NTooltip
        >
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton size="tiny" quaternary circle @click="reset">
              <template #icon
                ><NIcon :size="16"><ContractOutline /></NIcon
              ></template>
            </NButton> </template
          >适应屏幕</NTooltip
        >
      </div>
    </div>
  </div>
</template>
