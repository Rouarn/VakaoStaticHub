<script setup lang="ts">
import { computed } from 'vue';

/**
 * 横向条形图（占比/计数通用）：纯 div + brand 渐变，无图表库依赖。
 */
const props = defineProps<{
  items: { label: string; value: number; hint?: string }[];
  max?: number;
  valueFormatter?: (value: number) => string;
  toneIndex?: number;
}>();

const TONES = [
  'from-brand-600 to-brand-400',
  'from-brand-500 to-brand-300',
  'from-brand-400 to-brand-200',
  'from-brand-800 to-brand-600',
];

const maxValue = computed(() => {
  if (props.max !== undefined) return props.max;
  return Math.max(1, ...props.items.map((i) => i.value));
});

const tone = computed(() => TONES[(props.toneIndex ?? 0) % TONES.length]);

const widthOf = (value: number) =>
  `${Math.max(0, Math.min(100, (value / maxValue.value) * 100))}%`;

const format = (value: number) =>
  props.valueFormatter ? props.valueFormatter(value) : String(value);
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div
      v-for="item in items"
      :key="item.label"
      class="flex flex-col gap-1 min-w-0"
    >
      <div class="flex items-baseline gap-2 min-w-0">
        <span class="text-12px text-ink truncate flex-1" :title="item.label">
          {{ item.label }}
        </span>
        <span class="text-11px text-ink-sub tabular-nums shrink-0">
          {{ format(item.value) }}<template v-if="item.hint"> · {{ item.hint }}</template>
        </span>
      </div>
      <div class="h-2 rounded-full bg-ink-sub/10 dark:bg-ink-dark-sub/15 overflow-hidden">
        <div
          class="h-full rounded-full bg-gradient-to-r transition-all duration-500"
          :class="tone"
          :style="{ width: widthOf(item.value) }"
        />
      </div>
    </div>
    <p v-if="items.length === 0" class="m-0 text-12px text-ink-sub">暂无数据</p>
  </div>
</template>
