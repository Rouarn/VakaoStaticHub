<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { NButton, NIcon, NModal, useMessage } from 'naive-ui';
import { CopyOutline, DownloadOutline } from '@vicons/ionicons5';
import { colors } from '@/config/design-tokens';

/**
 * 分享二维码弹窗：qrcode 动态 import（不进首屏），
 * 画布颜色取自 design-tokens，避免组件散写色值。
 */
const props = defineProps<{
  show: boolean;
  url: string;
  filename?: string;
}>();

const emit = defineEmits<{ 'update:show': [boolean] }>();

const message = useMessage();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const rendering = ref(false);
const ready = ref(false);
const failed = ref('');

async function render() {
  if (!props.show || !props.url || !canvasEl.value) return;
  rendering.value = true;
  ready.value = false;
  failed.value = '';
  try {
    const QRCode = (await import('qrcode')).default;
    await QRCode.toCanvas(canvasEl.value, props.url, {
      width: 232,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: colors.ink.primary,
        light: colors.brand[50],
      },
    });
    ready.value = true;
  } catch (e) {
    failed.value = e instanceof Error ? e.message : '二维码生成失败';
  } finally {
    rendering.value = false;
  }
}

watch(
  () => [props.show, props.url] as const,
  ([show]) => {
    if (show) {
      // 等 NModal 挂载出 canvas 后再绘制
      requestAnimationFrame(() => void render());
    }
  },
  { immediate: true },
);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.url);
    message.success('链接已复制');
  } catch {
    message.error('复制失败，请手动选择链接');
  }
}

function downloadPng() {
  const canvas = canvasEl.value;
  if (!canvas || !ready.value) return;
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = props.filename ?? 'share-qr.png';
  link.click();
}

onBeforeUnmount(() => {
  ready.value = false;
});
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="分享二维码"
    class="w-420px!"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col items-center gap-3">
      <canvas
        ref="canvasEl"
        class="rounded-xl bg-white p-1 shadow-glass"
        :class="{ 'opacity-40': rendering || failed }"
      />
      <p v-if="failed" class="m-0 text-12px text-ink-sub">{{ failed }}</p>
      <p class="m-0 text-11px text-ink-sub break-all text-center">{{ url }}</p>
      <div class="flex items-center gap-2">
        <NButton size="small" :disabled="!ready" @click="downloadPng">
          <template #icon><NIcon><DownloadOutline /></NIcon></template>
          下载 PNG
        </NButton>
        <NButton size="small" :disabled="!url" @click="copy">
          <template #icon><NIcon><CopyOutline /></NIcon></template>
          复制链接
        </NButton>
      </div>
    </div>
  </NModal>
</template>
