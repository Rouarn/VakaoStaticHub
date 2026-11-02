<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import { AlertCircleOutline, RefreshOutline } from '@vicons/ionicons5';

/** 统一错误态：展示后端信封解析后的文案 + 重试 */
defineProps<{
  message: string;
  title?: string;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div
    class="glass-panel border-dashed! px-6 py-8 flex flex-col items-center text-center gap-3"
  >
    <div class="glass-chip w-12 h-12 flex items-center justify-center">
      <NIcon :size="24" class="text-ink-sub">
        <AlertCircleOutline />
      </NIcon>
    </div>
    <p class="m-0 text-14px font-600 text-ink">{{ title ?? '加载失败' }}</p>
    <p class="m-0 max-w-460px text-12px text-ink-sub leading-5 whitespace-pre-line">
      {{ message }}
    </p>
    <NButton size="small" quaternary @click="emit('retry')">
      <template #icon><NIcon><RefreshOutline /></NIcon></template>
      重试
    </NButton>
  </div>
</template>
