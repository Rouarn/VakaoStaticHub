<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  NButton,
  NColorPicker,
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui';
import {
  CopyOutline,
  DownloadOutline,
  ImageOutline,
  LinkOutline,
  RefreshOutline,
} from '@vicons/ionicons5';
import {
  buildPlaceholderPresetUrl,
  buildPlaceholderUrl,
} from '@/api/placeholder';
import PageHeader from '@/components/common/page-header.vue';

/**
 * 占位图生成器
 *
 * 后端 GET /placeholder/:width/:height 只输出 SVG；
 * PNG / JPEG 由前端把 SVG 栅格化到 canvas 后导出（不改变后端）。
 */
const message = useMessage();

type DownloadFormat = 'svg' | 'png' | 'jpeg';

const form = reactive({
  width: 300,
  height: 150,
  text: '',
  bgColor: '#dddddd',
  textColor: '#7a7a7a',
  fontFamily: 'sans-serif',
  fontWeight: 'bold',
  fontSize: null as number | null,
  format: 'svg' as DownloadFormat,
});

const fontFamilyOptions = [
  { label: 'sans-serif（默认）', value: 'sans-serif' },
  { label: 'serif', value: 'serif' },
  { label: 'monospace', value: 'monospace' },
  { label: 'PingFang SC', value: 'PingFang SC' },
  { label: 'Microsoft YaHei', value: 'Microsoft YaHei' },
  { label: 'Arial', value: 'Arial' },
];
const fontWeightOptions = [
  { label: 'bold（默认）', value: 'bold' },
  { label: 'normal', value: 'normal' },
  { label: '300', value: '300' },
  { label: '500', value: '500' },
  { label: '600', value: '600' },
  { label: '800', value: '800' },
];
const formatOptions = [
  { label: 'SVG（后端原生）', value: 'svg' },
  { label: 'PNG（前端栅格化）', value: 'png' },
  { label: 'JPEG（前端栅格化）', value: 'jpeg' },
];

const presets = [
  { label: '300×150', width: 300, height: 150 },
  { label: '200×200', width: 200, height: 200 },
  { label: '800×600', width: 800, height: 600 },
  { label: '1280×720', width: 1280, height: 720 },
  { label: '1000×1000', width: 1000, height: 1000 },
  { label: '1920×1080', width: 1920, height: 1080 },
];

function applyPreset(width: number, height: number) {
  form.width = width;
  form.height = height;
  endpointMode.value = 'custom';
}

/** 接口形态：自定义宽高 / 默认 300×150 / 方形 512 */
const endpointMode = ref<'custom' | 'default' | 'square'>('custom');
const SQUARE_SIZE = 512;

const previewSize = computed(() => {
  if (endpointMode.value === 'default') return { width: 300, height: 150 };
  if (endpointMode.value === 'square')
    return { width: SQUARE_SIZE, height: SQUARE_SIZE };
  return { width: form.width, height: form.height };
});

const styleParams = computed(() => ({
  text: form.text.trim(),
  bgColor: form.bgColor,
  textColor: form.textColor,
  fontFamily: form.fontFamily,
  fontWeight: form.fontWeight,
  ...(form.fontSize ? { fontSize: form.fontSize } : {}),
}));

const url = computed(() =>
  endpointMode.value === 'custom'
    ? buildPlaceholderUrl({
        width: form.width,
        height: form.height,
        ...styleParams.value,
      })
    : buildPlaceholderPresetUrl(
        endpointMode.value,
        SQUARE_SIZE,
        styleParams.value,
      ),
);

const previewError = ref(false);
const downloading = ref(false);

function reloadPreview() {
  previewError.value = false;
  // 修改 query 会触发 img 重新请求；这里仅用于预览加载失败后的重试
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(url.value);
    message.success('占位图链接已复制');
  } catch {
    message.error('复制失败，请手动选择链接');
  }
}

function saveBlob(blob: Blob, ext: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `placeholder-${form.width}x${form.height}.${ext}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function rasterize(
  svgText: string,
  width: number,
  height: number,
  format: 'png' | 'jpeg',
): Promise<Blob> {
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('当前浏览器不支持 canvas，无法导出位图'));
        return;
      }
      if (format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('位图导出失败'));
        },
        format === 'png' ? 'image/png' : 'image/jpeg',
        0.92,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('SVG 加载失败，无法栅格化'));
    };
    image.src = objectUrl;
  });
}

async function download() {
  const size = previewSize.value;
  if (
    size.width < 1 ||
    size.width > 4096 ||
    size.height < 1 ||
    size.height > 4096
  ) {
    message.error('宽高需在 1~4096 之间');
    return;
  }
  downloading.value = true;
  try {
    const res = await fetch(url.value);
    if (!res.ok) {
      throw new Error(`占位图生成失败（HTTP ${res.status}）`);
    }
    const svgText = await res.text();
    if (form.format === 'svg') {
      saveBlob(
        new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }),
        'svg',
      );
    } else {
      const blob = await rasterize(
        svgText,
        size.width,
        size.height,
        form.format,
      );
      saveBlob(blob, form.format === 'png' ? 'png' : 'jpg');
    }
    message.success(
      `已下载 ${size.width}×${size.height} ${form.format.toUpperCase()}`,
    );
  } catch (e) {
    message.error(e instanceof Error ? e.message : '下载失败');
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4">
    <PageHeader
      title="占位图生成"
      description="自定义尺寸、文字与配色，实时预览并下载；后端只输出 SVG，位图格式由前端栅格化"
      :icon="ImageOutline"
    >
      <template #actions>
        <NButton size="small" quaternary @click="copyUrl">
          <template #icon
            ><NIcon><CopyOutline /></NIcon
          ></template>
          复制链接
        </NButton>
        <NButton
          size="small"
          type="primary"
          :loading="downloading"
          @click="download"
        >
          <template #icon
            ><NIcon><DownloadOutline /></NIcon
          ></template>
          下载
        </NButton>
      </template>
    </PageHeader>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1">
      <div class="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)] items-start">
        <!-- 配置面板 -->
        <section class="glass-panel px-4 py-4 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-11px text-ink-sub mr-1">常用尺寸</span>
            <NButton
              v-for="preset in presets"
              :key="preset.label"
              size="tiny"
              quaternary
              @click="applyPreset(preset.width, preset.height)"
            >
              {{ preset.label }}
            </NButton>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-11px text-ink-sub mr-1">接口形态</span>
            <NButton
              size="tiny"
              :type="endpointMode === 'custom' ? 'primary' : 'default'"
              @click="endpointMode = 'custom'"
            >
              自定义宽高
            </NButton>
            <NButton
              size="tiny"
              :type="endpointMode === 'default' ? 'primary' : 'default'"
              @click="endpointMode = 'default'"
            >
              默认 300×150
            </NButton>
            <NButton
              size="tiny"
              :type="endpointMode === 'square' ? 'primary' : 'default'"
              @click="endpointMode = 'square'"
            >
              方形 {{ SQUARE_SIZE }}
            </NButton>
          </div>
          <p
            v-if="endpointMode !== 'custom'"
            class="m-0 text-10px text-ink-sub"
          >
            当前使用
            <code class="font-mono">{{
              endpointMode === 'default' ? '/placeholder' : '/placeholder/512'
            }}</code>
            ，宽高由接口固定；文字与配色仍通过 query 生效。
          </p>

          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">宽度（1~4096）</label>
              <NInputNumber
                v-model:value="form.width"
                size="small"
                :min="1"
                :max="4096"
                :step="10"
                @update:value="endpointMode = 'custom'"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">高度（1~4096）</label>
              <NInputNumber
                v-model:value="form.height"
                size="small"
                :min="1"
                :max="4096"
                :step="10"
                @update:value="endpointMode = 'custom'"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-11px text-ink-sub"
              >文字（留空显示「宽×高」）</label
            >
            <NInput
              v-model:value="form.text"
              size="small"
              placeholder="例如：封面占位"
            />
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">背景色</label>
              <NColorPicker
                v-model:value="form.bgColor"
                size="small"
                :modes="['hex']"
                :show-alpha="false"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">文字色</label>
              <NColorPicker
                v-model:value="form.textColor"
                size="small"
                :modes="['hex']"
                :show-alpha="false"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">字体</label>
              <NSelect
                v-model:value="form.fontFamily"
                size="small"
                :options="fontFamilyOptions"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">字重</label>
              <NSelect
                v-model:value="form.fontWeight"
                size="small"
                :options="fontWeightOptions"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">字号（留空自动）</label>
              <NInputNumber
                v-model:value="form.fontSize"
                size="small"
                clearable
                :min="1"
                :max="4096"
                placeholder="自动：短边 20%"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-11px text-ink-sub">下载格式</label>
              <NSelect
                v-model:value="form.format"
                size="small"
                :options="formatOptions"
              />
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap pt-1">
            <NTag size="tiny" :bordered="false" type="info">
              {{ form.width }}×{{ form.height }}
            </NTag>
            <NTag size="tiny" :bordered="false">
              字号
              {{
                form.fontSize ??
                Math.floor(Math.min(form.width, form.height) * 0.2)
              }}
            </NTag>
          </div>
        </section>

        <!-- 预览 -->
        <section class="glass-panel px-4 py-4 flex flex-col gap-3 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="m-0 text-13px font-600 text-ink">实时预览</h2>
            <NButton size="tiny" quaternary @click="reloadPreview">
              <template #icon
                ><NIcon><RefreshOutline /></NIcon
              ></template>
              刷新
            </NButton>
            <span class="ml-auto text-11px text-ink-sub">
              预览始终为后端 SVG；PNG/JPEG 在下载时栅格化
            </span>
          </div>

          <div
            class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/40 dark:bg-black/20 min-h-280px flex items-center justify-center p-4 overflow-hidden"
          >
            <img
              v-if="!previewError"
              :key="url"
              :src="url"
              :alt="`占位图 ${previewSize.width}x${previewSize.height}`"
              class="max-w-full max-h-360px object-contain rounded-md shadow-sm"
              @error="previewError = true"
            />
            <div v-else class="flex flex-col items-center gap-2 text-center">
              <NIcon :size="26" class="text-ink-sub"><ImageOutline /></NIcon>
              <p class="m-0 text-12px text-ink-sub">
                预览加载失败，请检查尺寸是否在 1~4096 之间
              </p>
              <NButton size="tiny" @click="reloadPreview">重试</NButton>
            </div>
          </div>

          <div class="flex items-center gap-2 min-w-0">
            <NIcon :size="14" class="text-ink-sub shrink-0"
              ><LinkOutline
            /></NIcon>
            <NInput :value="url" size="small" readonly class="font-mono" />
            <NButton size="small" quaternary @click="copyUrl">
              <template #icon
                ><NIcon><CopyOutline /></NIcon
              ></template>
            </NButton>
          </div>

          <p class="m-0 text-10px text-ink-sub">
            接口：GET /placeholder/:width/:height（query: text / bgColor /
            textColor / fontFamily / fontWeight / fontSize）。后端仅返回
            image/svg+xml。
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
