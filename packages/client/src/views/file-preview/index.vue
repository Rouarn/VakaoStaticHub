<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import type { Component } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NIcon, NInput } from 'naive-ui';
import {
  AlertCircleOutline,
  CloseOutline,
  DocumentTextOutline,
  DownloadOutline,
  LinkOutline,
} from '@vicons/ionicons5';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import type { PreviewTarget } from '@/components/preview/types';
import DefaultPreview from '@/components/preview/default-preview.vue';
import {
  registerBuiltinPreviews,
  resolvePreview,
} from '@/utils/preview-registry';
import { buildFileUrl, buildThumbUrl } from '@/utils/file-url';
import {
  extensionFromContentType,
  formatBytes,
  hasExtension,
  isImage,
} from '@/utils/file-types';
import { normalizeNameHint } from '@/utils/preview-name';
import { previewSrc } from '@/utils/preview-source';

/**
 * 文件预览（内部 / 外部共用一份逻辑与渲染）
 *
 * - /local-file-preview（DefaultLayout 内，需登录）：页头 + 地址输入 + 内容区预览，
 *   输入框只在内部壳里渲染；
 * - /file-preview（公开，独立整页）：不渲染页头/输入，只认 URL 参数，
 *   无参数时只显示图标提示，有参数时整页内联渲染。
 * 两者共用 ?file= / ?url= / ?code=+name 的解析与预览组件分发；
 * name 的三种形态由 normalizeNameHint 统一处理，两条入口语义一致。
 */
const route = useRoute();
/** 内部还是外部：由路由名区分，决定是否显示输入工具栏 */
const isInternal = computed(() => route.name === 'local-file-preview');

const url = ref('');
const target = ref<PreviewTarget | null>(null);
/** 用于选择预览组件的文件名：可能与展示名不同（如 &name=.mp3） */
const previewName = ref('');
const invalid = ref('');
const component = shallowRef<Component | null>(null);
const loading = ref(false);
const failed = ref('');
const canOpen = computed(() => url.value.trim().length > 0);
/** 最终预览地址：演示文稿会被改写成带文件版本的转换地址，key 跟着版本走 */
const previewSource = computed(() =>
  target.value
    ? previewSrc(target.value.filename, target.value.src, target.value.version)
    : '',
);

function filenameOf(raw: string): string {
  try {
    const u = new URL(raw, window.location.href);
    const name = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    return name || 'file';
  } catch {
    return 'file';
  }
}

function isSameOrigin(raw: string): boolean {
  try {
    return new URL(raw, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * 同源且最后一段没有扩展名时，用 HEAD 的 content-type 推断扩展名。
 * 跨域读不到响应头（无 CORS 暴露），直接返回空串由调用方回落默认预览，
 * 不猜类型、不伪造成功。调用方已确认该 URL 无扩展名。
 */
async function probeExtension(raw: string): Promise<string> {
  if (!isSameOrigin(raw)) return '';
  try {
    const res = await fetch(raw, { method: 'HEAD' });
    if (!res.ok) return '';
    return extensionFromContentType(res.headers.get('content-type'));
  } catch {
    return '';
  }
}

/**
 * 短链预览的真实大小：同源 HEAD 读 content-length。
 * 跨域或读取失败保持未知（显示「大小未知」），不伪造 0 B。
 */
async function fillSizeFromHead(raw: string, expectSrc = raw) {
  if (!isSameOrigin(raw)) return;
  try {
    const res = await fetch(raw, { method: 'HEAD' });
    if (!res.ok || target.value?.src !== expectSrc) return;
    const length = Number(res.headers.get('content-length'));
    if (!Number.isFinite(length) || length <= 0) return;
    target.value = { ...target.value, size: length };
  } catch {
    /* 保持未知 */
  }
}

function setTarget(
  src: string,
  downloadSrc: string,
  filename: string,
  nameForPreview = filename,
  autoLoad = true,
  version?: string,
) {
  // 未知大小不写 0：交给展示层显示「大小未知」
  target.value = {
    src,
    downloadSrc,
    filename,
    ...(version ? { version } : {}),
  };
  previewName.value = nameForPreview;
  invalid.value = '';
  if (autoLoad) void load();
}

async function open(raw?: string, name?: string) {
  const value = (raw ?? url.value).trim();
  if (!value) return;
  let absolute: string;
  try {
    const parsed = new URL(value, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      invalid.value = '只支持 http / https 地址';
      return;
    }
    absolute = parsed.toString();
  } catch {
    invalid.value = '地址格式不正确，请填写完整 URL 或 /static/... 路径';
    return;
  }
  if (isInternal.value) url.value = value;

  const fallback = filenameOf(absolute);
  const hint = normalizeNameHint(name, fallback);
  if (hint) {
    setTarget(absolute, absolute, hint.display, hint.previewName);
    return;
  }

  if (hasExtension(fallback)) {
    setTarget(absolute, absolute, fallback);
    return;
  }

  // 无扩展名的同源链接：先占位等 HEAD 结果，避免先闪一下默认卡片
  setTarget(absolute, absolute, fallback, fallback, false);
  loading.value = true;
  const ext = await probeExtension(absolute);
  if (target.value?.src !== absolute) return;
  loading.value = false;
  if (ext) previewName.value = `${fallback}.${ext}`;
  await load();
}

function clear() {
  target.value = null;
  previewName.value = '';
  component.value = null;
  failed.value = '';
}

async function load() {
  const current = target.value;
  if (!current) return;
  loading.value = true;
  failed.value = '';
  component.value = null;
  try {
    const loader = resolvePreview(previewName.value);
    component.value = loader ? await loader() : DefaultPreview;
  } catch (e) {
    failed.value = e instanceof Error ? e.message : '预览组件加载失败';
  } finally {
    loading.value = false;
  }
}

/** query 值可能是数组或 null，统一取第一个字符串 */
function firstQueryValue(value: unknown): string {
  const list: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  const first: unknown = list[0];
  return typeof first === 'string' ? first : '';
}

/** 解析 URL 参数；进入页面和路由切换时都重新应用 */
function applyQuery() {
  clear();
  invalid.value = '';
  if (isInternal.value) url.value = '';

  const { file: fileQuery, url: urlQuery, code, name } = route.query;
  const raw =
    typeof fileQuery === 'string' && fileQuery.trim()
      ? fileQuery.trim()
      : typeof urlQuery === 'string' && urlQuery.trim()
        ? urlQuery.trim()
        : '';
  if (raw) {
    if (isInternal.value) url.value = raw;
    void open(raw, firstQueryValue(name));
    return;
  }

  if (typeof code === 'string' && code) {
    const fallback = `file-${code}`;
    const hint = normalizeNameHint(name, fallback);
    const fileName = hint?.previewName ?? fallback;
    // 图片走预览档，其他类型仍需原始内容
    const src = isImage(fileName)
      ? buildThumbUrl({ code }, 'preview')
      : buildFileUrl({ code });
    if (isInternal.value) url.value = src;
    setTarget(
      src,
      buildFileUrl({ code, download: true }),
      hint?.display ?? fallback,
      fileName,
      true,
      // 内容短码本身就是内容哈希派生的，作为转换地址的版本号即可换址
      code,
    );
    // 图片预览走缩略图，大小仍按原始文件读
    void fillSizeFromHead(buildFileUrl({ code }), src);
  }
}

registerBuiltinPreviews();

onMounted(applyQuery);
watch(() => route.fullPath, applyQuery);
</script>

<template>
  <div v-if="isInternal" class="h-full flex flex-col gap-3">
    <!-- 内部：DefaultLayout 内容区，保留输入工具栏 -->
    <PageHeader
      title="本地预览"
      description="输入文件地址在内容区直接预览；也支持 ?file= 参数直达"
    >
      <template #actions>
        <NButton v-if="target" size="small" quaternary @click="clear">
          <template #icon>
            <NIcon>
              <CloseOutline />
            </NIcon>
          </template>
          关闭预览
        </NButton>
      </template>
    </PageHeader>

    <section class="glass-panel px-3 py-2.5 flex items-center gap-2">
      <div class="flex-1 min-w-0">
        <NInput
          v-model:value="url"
          size="small"
          clearable
          placeholder="输入文件地址，如 /static/files/default/TemporaryFile/a.png 或 https://..."
          @keyup.enter="open()"
        >
          <template #prefix>
            <NIcon :size="15" class="text-ink-sub">
              <LinkOutline />
            </NIcon>
          </template>
        </NInput>
      </div>
      <NButton type="primary" size="small" :disabled="!canOpen" @click="open()">
        预览
      </NButton>
    </section>

    <p v-if="invalid" class="m-0 px-1 text-12px text-red-500">{{ invalid }}</p>

    <section class="flex-1 min-h-0 glass-panel overflow-hidden flex flex-col">
      <template v-if="target">
        <header
          class="flex items-center gap-2 px-4 py-2 border-b border-[var(--mat-line)] shrink-0"
        >
          <p class="m-0 min-w-0 text-13px font-600 text-ink truncate">
            {{ target.filename }}
          </p>
          <span
            v-if="target.size !== undefined"
            class="text-11px text-ink-sub shrink-0"
          >
            {{ formatBytes(target.size) }}
          </span>
          <div class="ml-auto flex items-center gap-1 shrink-0">
            <NButton
              tag="a"
              :href="target.downloadSrc"
              download
              size="small"
              quaternary
              circle
            >
              <template #icon>
                <NIcon>
                  <DownloadOutline />
                </NIcon>
              </template>
            </NButton>
            <NButton size="small" quaternary circle @click="clear">
              <template #icon>
                <NIcon>
                  <CloseOutline />
                </NIcon>
              </template>
            </NButton>
          </div>
        </header>
        <div class="flex-1 min-h-0 bg-[var(--mat-panel-strong)]">
          <div
            v-if="loading"
            class="h-full flex items-center justify-center text-13px text-ink-sub"
          >
            加载中…
          </div>
          <div
            v-else-if="failed"
            class="h-full flex items-center justify-center text-13px text-ink-sub"
          >
            {{ failed }}
          </div>
          <component
            :is="component"
            v-else-if="component"
            :key="previewSource"
            :src="previewSource"
            :filename="target.filename"
            :size="target.size"
            :version="target.version"
            :download-src="target.downloadSrc"
          />
        </div>
      </template>

      <EmptyState
        v-else
        flat
        :icon="DocumentTextOutline"
        title="还没有预览内容"
        description="在上方输入文件地址后点击「预览」，支持图片、视频、音频、PDF、文本、Office 与压缩包。"
      />
    </section>
  </div>

  <div v-else class="fixed inset-0 z-10 overflow-hidden text-white">
    <!-- 外部：独立整页，不显示页头/输入，只认 URL 参数 -->
    <div
      v-if="invalid"
      class="h-full w-full flex flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <NIcon :size="48" class="text-white/25">
        <AlertCircleOutline />
      </NIcon>
      <p class="m-0 text-13px text-white/55">{{ invalid }}</p>
    </div>

    <div
      v-else-if="!target"
      class="h-full w-full flex flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <NIcon :size="54" class="text-white/25">
        <DocumentTextOutline />
      </NIcon>
      <p class="m-0 text-13px text-white/55">
        通过 URL 参数
        <code class="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-12px"
          >?file=</code
        >
        指定需要预览的文件
      </p>
    </div>

    <div v-else class="h-full w-full">
      <div
        v-if="loading"
        class="h-full w-full flex items-center justify-center text-13px text-white/50"
      >
        加载中…
      </div>
      <div
        v-else-if="failed"
        class="h-full w-full flex items-center justify-center text-13px text-white/50"
      >
        {{ failed }}
      </div>
      <component
        :is="component"
        v-else-if="component"
        :key="previewSource"
        :src="previewSource"
        :filename="target.filename"
        :size="target.size"
        :version="target.version"
        :download-src="target.downloadSrc"
      />
    </div>
  </div>
</template>
