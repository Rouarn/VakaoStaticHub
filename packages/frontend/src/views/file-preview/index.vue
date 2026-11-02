<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NIcon, NInput } from 'naive-ui';
import { EyeOutline, LinkOutline } from '@vicons/ionicons5';
import PublicPage from '@/components/common/public-page.vue';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';
import { buildFileUrl } from '@/utils/file-url';

/**
 * 独立文件预览页（/file-preview，公开）
 *
 * 输入任意可跨域访问的直链即可预览，走同一份 preview-registry 分发；
 * HTML 仍由 html-preview.vue 以 sandbox=""（无 allow-same-origin）渲染。
 * 支持 ?url= 参数直接打开，方便分享。
 */
const route = useRoute();
const url = ref('');
const show = ref(false);
const targets = ref<PreviewTarget[]>([]);
const index = ref(0);
const invalid = ref('');

const canOpen = computed(() => url.value.trim().length > 0);

function filenameOf(raw: string): string {
  try {
    const u = new URL(raw, window.location.href);
    const name = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    return name || 'file';
  } catch {
    return 'file';
  }
}

function openPreview() {
  const raw = url.value.trim();
  if (!raw) return;
  let absolute: string;
  try {
    absolute = new URL(raw, window.location.href).toString();
  } catch {
    invalid.value = 'URL 格式不正确，请填写完整地址（如 https://example.com/a.pdf）';
    return;
  }
  invalid.value = '';
  const filename = filenameOf(absolute);
  targets.value = [{ filename, src: absolute, downloadSrc: absolute, size: 0 }];
  index.value = 0;
  show.value = true;
}

onMounted(() => {
  // 优先使用结构化的 rootId/category/path：直链由 utils/file-url.ts 统一构造，
  // 避免调用方手工拼 /static（历史 bug 就是这里多叠了一层前缀）。
  const { rootId, category, path } = route.query;
  if (
    typeof rootId === 'string' &&
    typeof category === 'string' &&
    typeof path === 'string' &&
    rootId &&
    category &&
    path
  ) {
    url.value = buildFileUrl({ rootId, category, relPath: path });
    invalid.value = '';
    const filename = path.split('/').pop() ?? 'file';
    targets.value = [
      {
        filename,
        src: url.value,
        downloadSrc: buildFileUrl({
          rootId,
          category,
          relPath: path,
          download: true,
        }),
        size: 0,
      },
    ];
    index.value = 0;
    show.value = true;
    return;
  }

  const q = route.query.url;
  if (typeof q === 'string' && q.trim()) {
    url.value = q;
    openPreview();
  }
});
</script>

<template>
  <PublicPage>
    <div class="min-h-full flex items-center justify-center px-6 py-10">
      <div class="glass-panel w-full max-w-520px p-6 flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <div class="glass-chip w-10 h-10 flex items-center justify-center">
            <NIcon :size="22" class="text-brand-600 dark:text-brand-400">
              <EyeOutline />
            </NIcon>
          </div>
          <div>
            <h1 class="m-0 text-17px font-600 text-ink">文件预览</h1>
            <p class="m-0 text-12px text-ink-sub">
              输入可跨域访问的文件直链，按扩展名自动分发到对应预览组件
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <NInput
            v-model:value="url"
            placeholder="https://example.com/report.pdf"
            clearable
            @keyup.enter="openPreview"
          >
            <template #prefix>
              <NIcon :size="15" class="text-ink-sub"><LinkOutline /></NIcon>
            </template>
          </NInput>
          <NButton type="primary" :disabled="!canOpen" @click="openPreview">
            预览
          </NButton>
        </div>
        <p v-if="invalid" class="m-0 text-12px text-red-500">{{ invalid }}</p>

        <div class="glass-card px-4 py-3 flex flex-col gap-1.5">
          <p class="m-0 text-12px font-600 text-ink">支持的格式</p>
          <p class="m-0 text-11px text-ink-sub leading-5">
            图片、视频、音频、文本 / 代码、Markdown、HTML（沙箱隔离）、PDF、Word（.docx）、
            Excel、压缩包（zip 条目列表）；其余格式展示元信息与下载入口。
          </p>
        </div>
      </div>
    </div>

    <PreviewDialog
      v-model:show="show"
      v-model:index="index"
      :files="targets"
    />
  </PublicPage>
</template>
