<script setup lang="ts">
import { computed } from 'vue';

/**
 * 极简环形占比图（纯 SVG，不引入图表库，避免首屏体积与新的配色来源）
 * 颜色只用 brand 色阶，通过静态类名保证 UnoCSS 能生成。
 */
const props = defineProps<{
  segments: { label: string; value: number }[];
  centerLabel?: string;
  centerValue?: string;
  size?: number;
}>();

const TONES = [
  'text-brand-600 dark:text-brand-500',
  'text-brand-400 dark:text-brand-300',
  'text-brand-300 dark:text-brand-200',
  'text-brand-800 dark:text-brand-700',
  'text-brand-200 dark:text-brand-100',
  'text-brand-500 dark:text-brand-600',
];

const total = computed(() =>
  props.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0),
);

const arcs = computed(() => {
  const sum = total.value;
  let offset = 0;
  return props.segments.map((seg, i) => {
    const ratio = sum > 0 ? Math.max(0, seg.value) / sum : 0;
    const arc = {
      key: seg.label,
      label: seg.label,
      value: seg.value,
      percent: ratio * 100,
      dash: ratio * 100,
      offset,
      tone: TONES[i % TONES.length],
      color: `color-${i}`,
    };
    offset += ratio * 100;
    return arc;
  });
});

const radius = 48;
const circumference = 2 * Math.PI * radius;
</script>

<template>
  <div class="flex items-center gap-5 flex-wrap">
    <div
      class="relative shrink-0"
      :style="{ width: `${size ?? 132}px`, height: `${size ?? 132}px` }"
    >
      <svg viewBox="0 0 120 120" class="w-full h-full">
        <circle
          cx="60"
          cy="60"
          :r="radius"
          fill="none"
          stroke="currentColor"
          stroke-width="10"
          class="text-ink-sub/15 dark:text-ink-dark-sub/20"
        />
        <circle
          v-for="arc in arcs"
          :key="arc.key"
          cx="60"
          cy="60"
          :r="radius"
          fill="none"
          stroke="currentColor"
          stroke-width="10"
          stroke-linecap="round"
          :class="arc.tone"
          :stroke-dasharray="`${arc.dash * circumference / 100} ${circumference}`"
          :stroke-dashoffset="`-${arc.offset * circumference / 100}`"
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <p class="m-0 text-18px font-600 text-ink">{{ centerValue ?? '—' }}</p>
        <p class="m-0 text-10px text-ink-sub">{{ centerLabel ?? '总计' }}</p>
      </div>
    </div>

    <ul class="m-0 p-0 list-none flex flex-col gap-1.5 min-w-0 flex-1">
      <li
        v-for="(arc, i) in arcs"
        :key="arc.key"
        class="flex items-center gap-2 text-12px min-w-0"
      >
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0 bg-current"
          :class="TONES[i % TONES.length]"
        />
        <span class="text-ink-sub truncate flex-1" :title="arc.label">{{ arc.label }}</span>
        <span class="text-ink font-600 tabular-nums">{{ arc.percent.toFixed(1) }}%</span>
      </li>
      <li v-if="arcs.length === 0" class="text-12px text-ink-sub">暂无数据</li>
    </ul>
  </div>
</template>
