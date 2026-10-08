<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import QRCode from 'qrcode';
import { NButton, NIcon, NText, useMessage } from 'naive-ui';
import { DownloadOutline, QrCodeOutline } from '@vicons/ionicons5';

const props = withDefaults(
  defineProps<{
    /** 要编码为二维码的内容 */
    value: string;
    /** 二维码尺寸（px），对应输出图片的宽度 */
    size?: number;
    /** 描述文字（按钮上方/卡片标题） */
    label?: string;
    /** 保存文件名（不含扩展名），默认 'qrcode' */
    saveName?: string;
    /** 显示模式：button 卡片式按钮、plain 仅图片+保存按钮 */
    mode?: 'button' | 'plain';
    /** 是否显示组件内置的保存按钮；为 false 时父组件可调用暴露的 save 方法自行放置按钮 */
    showSaveButton?: boolean;
  }>(),
  {
    size: 200,
    label: '二维码',
    saveName: 'qrcode',
    mode: 'plain',
    showSaveButton: true,
  },
);

const message = useMessage();
const dataUrl = ref('');
const loading = ref(false);

async function generate() {
  if (!props.value) {
    dataUrl.value = '';
    return;
  }
  loading.value = true;
  try {
    dataUrl.value = await QRCode.toDataURL(props.value, {
      width: props.size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    });
  } catch (err) {
    console.error('生成二维码失败:', err);
    message.error('生成二维码失败');
    dataUrl.value = '';
  } finally {
    loading.value = false;
  }
}

function save() {
  if (!dataUrl.value) {
    message.warning('二维码尚未生成');
    return;
  }
  const link = document.createElement('a');
  link.href = dataUrl.value;
  link.download = `${props.saveName}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  message.success('已保存二维码图片');
}

onMounted(generate);
watch(() => [props.value, props.size] as const, generate);

const fileName = computed(() => `${props.saveName}.png`);

defineExpose<{
  save: () => void;
  dataUrl: typeof dataUrl;
  loading: typeof loading;
}>({
  save,
  dataUrl,
  loading,
});
</script>

<template>
  <div v-if="mode === 'button'" class="flex flex-col items-center gap-2">
    <button
      type="button"
      class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-base bg-base hover:border-primary hover:bg-primary/5 transition-all active:scale-95 w-full"
      :title="`保存 ${fileName}`"
      :disabled="!dataUrl"
      @click="save"
    >
      <div
        class="rounded-lg overflow-hidden flex items-center justify-center bg-white transition-colors"
        :style="{ width: `${size}px`, height: `${size}px` }"
      >
        <img
          v-if="dataUrl"
          :src="dataUrl"
          :alt="label"
          class="w-full h-full object-contain"
        />
        <NIcon v-else :size="48" class="text-gray-300">
          <QrCodeOutline />
        </NIcon>
      </div>
      <NText class="font-medium">{{ label }}</NText>
      <NText class="text-xs text-primary flex items-center gap-1">
        <NIcon :size="14">
          <DownloadOutline />
        </NIcon>
        点击保存图片
      </NText>
    </button>
  </div>

  <div v-else class="flex flex-col items-center gap-3">
    <div
      class="rounded-lg overflow-hidden flex items-center justify-center bg-white p-2 shadow-sm"
      :style="{ width: `${size + 16}px`, height: `${size + 16}px` }"
    >
      <img
        v-if="dataUrl"
        :src="dataUrl"
        :alt="label"
        class="w-full h-full object-contain"
      />
      <NIcon v-else :size="48" class="text-gray-300">
        <QrCodeOutline />
      </NIcon>
    </div>
    <NButton
      v-if="showSaveButton"
      size="small"
      type="primary"
      :loading="loading"
      @click="save"
    >
      <template #icon>
        <NIcon>
          <DownloadOutline />
        </NIcon>
      </template>
      保存二维码
    </NButton>
  </div>
</template>
