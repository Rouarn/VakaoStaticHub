<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NIcon, useMessage } from 'naive-ui';
import {
  InformationCircleOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5';
import { RequestError } from '@vakao/axios';
import type { ShareInfo } from '@vakao/shared';
import { getShareInfo, SHARE_TOKEN_RE, unlockShare } from '@/api/shares';
import type { ShareCollectionFile } from '@/api/shares';
import { buildShareFileUrl } from '@/utils/file-url';
import { isImage, isPreviewable } from '@/utils/file-types';
import { fileVersion } from '@/utils/preview-source';
import { formatDateTime } from '@/utils/format';
import PublicPage from '@/components/common/public-page.vue';
import { useListLoading } from '@/composables/use-list-loading';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';
import ShareGatePanel from './components/share-gate-panel.vue';
import ShareSingleFile from './components/share-single-file.vue';
import ShareCollectionPanel from './components/share-collection-panel.vue';
import ShareStatusEmpty from './components/share-status-empty.vue';
import type { ShareAccessPhase } from './components/types';

/**
 * 公开分享访问页
 *
 * 关键点：
 * - 使用 publicHttp，避免「密码错误 401」触发全局清态跳登录
 * - 状态码契约（后端统一）：404 不存在 / 410 已停用·已过期·次数用尽 /
 *   401 密码错误或访问令牌失效 / 429 限流
 * - 410 的三种原因用 message 区分，分别渲染停用、过期、次数用尽三种空态
 * - 解锁后凭 accessToken 访问文件，不再消耗打开次数
 */
const route = useRoute();
const router = useRouter();
const message = useMessage();

const token = computed(() => String(route.params.token ?? ''));
const tokenValid = computed(() => SHARE_TOKEN_RE.test(token.value));

type Phase = ShareAccessPhase;
const phase = ref<Phase>('loading');
const errorText = ref('');
const info = ref<ShareInfo | null>(null);

const password = ref('');
const passwordError = ref('');
const rateLimited = ref(false);
let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;
const unlocking = ref(false);
const accessToken = ref('');

const collectionFiles = ref<ShareCollectionFile[]>([]);
const collectionRootId = ref('');
const collectionCategory = ref('');
const {
  loading: collectionLoading,
  loadingText: collectionLoadingText,
  begin: beginCollectionLoading,
} = useListLoading({ text: '正在加载文件列表…' });
const collectionError = ref('');
/** 初始读取分享信息、校验访问密码同样使用统一加载文案 */
const { loadingText: bootLoadingText } = useListLoading({
  text: '正在读取分享信息…',
});
const { loadingText: unlockLoadingText } = useListLoading({
  text: '正在校验访问密码…',
});
/** 单文件分享的大小与修改时间：优先取分享信息里的 files[0]（后端已随 /s/{token} 下发） */
const singleSize = ref<number | null>(null);
const singleMtime = ref<number | null>(null);
const singleMissing = ref(false);
/** 单文件分享的版本标识，拼服务端转换地址用 */
const singleVersion = computed(() =>
  fileVersion(singleSize.value, singleMtime.value),
);
const collectionMissingCount = computed(
  () => collectionFiles.value.filter((file) => !file.exists).length,
);

const isExpiredByTime = computed(
  () =>
    info.value?.expiresAt !== null &&
    info.value?.expiresAt !== undefined &&
    info.value.expiresAt <= Date.now(),
);

const expiresLabel = computed(() => {
  const value = info.value;
  if (!value) return '—';
  if (value.expiresAt === null) return '永久有效';
  return `有效期至 ${formatDateTime(value.expiresAt)}`;
});

function errorOf(e: unknown) {
  if (e instanceof RequestError) {
    return {
      code: e.code,
      message:
        (e.response?.data as { message?: string | string[] } | undefined)
          ?.message ?? '',
    };
  }
  return { code: undefined, message: e instanceof Error ? e.message : '' };
}

function joinMessage(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean).join('；');
  return value ?? '';
}

/**
 * 把 410 Gone 的 message 映射为具体空态
 * 后端对「已停用 / 已过期 / 次数用尽」统一返回 410，并用 message 区分原因
 */
function unavailablePhase(text: string): Phase | null {
  if (text.includes('已停用')) return 'disabled';
  if (text.includes('次数已达上限')) return 'exhausted';
  if (text.includes('已过期')) return 'expired';
  return null;
}

/** 这些状态统一渲染为不可用空态 */
function isStatusPhase(value: Phase) {
  return (
    value === 'notfound' ||
    value === 'error' ||
    value === 'disabled' ||
    value === 'expired' ||
    value === 'exhausted'
  );
}

async function init() {
  accessToken.value = '';
  info.value = null;
  collectionFiles.value = [];
  collectionRootId.value = '';
  collectionCategory.value = '';
  singleSize.value = null;
  singleMtime.value = null;
  singleMissing.value = false;
  errorText.value = '';
  password.value = '';
  passwordError.value = '';
  rateLimited.value = false;

  if (!tokenValid.value) {
    phase.value = 'notfound';
    return;
  }

  phase.value = 'loading';
  try {
    info.value = await getShareInfo(token.value);
    if (isExpiredByTime.value) {
      phase.value = 'expired';
      return;
    }
    phase.value = 'gate';
  } catch (e) {
    const { code, message } = errorOf(e);
    const text = joinMessage(message);
    const unavailable = code === 410 ? unavailablePhase(text) : null;
    if (unavailable) {
      phase.value = unavailable;
      return;
    }
    if (code === 404 || text.includes('不存在')) {
      phase.value = 'notfound';
      return;
    }
    phase.value = 'error';
    errorText.value = text || '分享信息加载失败，请稍后重试';
  }
}

async function unlock() {
  if (unlocking.value) return;
  unlocking.value = true;
  passwordError.value = '';
  rateLimited.value = false;
  try {
    const result = await unlockShare(
      token.value,
      password.value.trim() || undefined,
    );
    accessToken.value = result.accessToken;
    password.value = '';
    phase.value = 'ready';
    applyShareFiles();
  } catch (e) {
    const { code, message } = errorOf(e);
    const text = joinMessage(message);

    if (code === 429) {
      rateLimited.value = true;
      passwordError.value =
        '尝试次数过多（同一链接每分钟最多 10 次），请等待约 1 分钟后再试。这不是密码错误。';
      if (rateLimitTimer) clearTimeout(rateLimitTimer);
      rateLimitTimer = setTimeout(() => {
        rateLimited.value = false;
        passwordError.value = '';
      }, 60_000);
      return;
    }
    const unavailable = code === 410 ? unavailablePhase(text) : null;
    if (unavailable) {
      phase.value = unavailable;
      return;
    }
    if (code === 404 || text.includes('不存在')) {
      phase.value = 'notfound';
      return;
    }
    if (code === 401) {
      passwordError.value = text.includes('需要访问密码')
        ? '该分享需要访问密码'
        : '访问密码错误，请重试';
      return;
    }
    passwordError.value = text || '解锁失败，请稍后重试';
  } finally {
    unlocking.value = false;
  }
}

/** 分享信息已包含全部文件元信息：解锁后直接使用，不再请求文件列表接口 */
function applyShareFiles() {
  const files = info.value?.files ?? [];
  if (singleFile.value) {
    const file = files[0];
    singleSize.value = file?.size ?? null;
    singleMtime.value = file?.mtime ?? null;
    singleMissing.value = file ? !file.exists : false;
    return;
  }
  collectionFiles.value = files;
  collectionRootId.value = info.value?.rootId ?? '';
  collectionCategory.value = info.value?.category ?? '';
}

/** 刷新按钮：重新读取分享信息（含文件元信息），保持已解锁状态 */
async function refreshFiles() {
  collectionError.value = '';
  beginCollectionLoading();
  try {
    info.value = await getShareInfo(token.value);
    applyShareFiles();
  } catch (e) {
    const { code, message } = errorOf(e);
    const text = joinMessage(message);
    const unavailable = code === 410 ? unavailablePhase(text) : null;
    if (unavailable) {
      phase.value = unavailable;
    } else {
      collectionError.value = text || '文件列表刷新失败';
    }
  } finally {
    collectionLoading.value = false;
  }
}

function fileUrl(index: number, download = false) {
  return buildShareFileUrl(token.value, {
    accessToken: accessToken.value,
    index,
    download,
  });
}

/** 分享页展示用图片地址：按 share 档位缩放，避免拉取原图 */
function imageUrl(index: number) {
  return buildShareFileUrl(token.value, {
    accessToken: accessToken.value,
    index,
    imageTier: 'share',
  });
}

const singleSrc = computed(() =>
  buildShareFileUrl(token.value, { accessToken: accessToken.value }),
);
const singleImageSrc = computed(() => imageUrl(0));
const singleDownloadSrc = computed(() =>
  buildShareFileUrl(token.value, {
    accessToken: accessToken.value,
    download: true,
  }),
);

function nameOf(path: string) {
  return path.split('/').pop() ?? path;
}

/**
 * 单文件视图仅在 shareType==='file' 时渲染。
 * shareType 由 filePaths 长度派生，是唯一的判定依据。
 */
const singleFile = computed(() => {
  if (info.value?.shareType !== 'file') return null;
  const path = info.value.filePaths[0];
  return { name: nameOf(path), path };
});

const previewShow = ref(false);
const previewIndex = ref(0);
const previewTargets = ref<PreviewTarget[]>([]);

/** 文件集合已解锁：中间区改为「只滚列表」，头尾固定 */
const isCollectionReady = computed(
  () => phase.value === 'ready' && !singleFile.value,
);

function openSinglePreview() {
  if (!singleFile.value) return;
  previewTargets.value = [
    {
      filename: singleFile.value.name,
      src: isImage(singleFile.value.name)
        ? singleImageSrc.value
        : singleSrc.value,
      downloadSrc: singleDownloadSrc.value,
      ...(singleSize.value !== null ? { size: singleSize.value } : {}),
      ...(singleVersion.value ? { version: singleVersion.value } : {}),
    },
  ];
  previewIndex.value = 0;
  previewShow.value = true;
}

function openCollectionPreview(index: number) {
  // 只把「存在且可预览」的文件放进预览队列，避免某个文件被删除后
  // 下标错位导致点 A 却预览 B。
  const previewable = collectionFiles.value
    .map((file, i) => ({ file, i }))
    .filter(({ file }) => file.exists && isPreviewable(file.name));
  const position = previewable.findIndex(({ i }) => i === index);
  if (position < 0) return;
  previewTargets.value = previewable.map(({ file, i }) => ({
    filename: file.name,
    src: isImage(file.name) ? imageUrl(i) : fileUrl(i),
    downloadSrc: fileUrl(i, true),
    size: file.size ?? undefined,
    version: fileVersion(file.size, file.mtime),
  }));
  previewIndex.value = position;
  previewShow.value = true;
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    message.success('页面地址已复制');
  } catch {
    message.error('复制失败，请手动复制浏览器地址');
  }
}

watch(token, () => void init());
onMounted(() => void init());
onBeforeUnmount(() => {
  if (rateLimitTimer) clearTimeout(rateLimitTimer);
});
</script>

<template>
  <PublicPage>
    <div class="share-access-shell flex flex-col items-center">
      <div class="w-full max-w-2xl flex flex-1 min-h-0 flex-col gap-4">
        <!-- 页头 -->
        <header
          class="glass-panel px-4 py-2.5 flex items-center gap-3 shrink-0"
        >
          <div class="min-w-0 flex items-baseline gap-2.5">
            <span class="text-11px text-ink-sub">分享 /</span>
            <h1 class="m-0 text-15px font-600 text-ink leading-tight">
              文件分享
            </h1>
            <p class="m-0 text-12px text-ink-sub truncate">
              token {{ token.slice(0, 8) }}…{{ token.slice(-6) }}
            </p>
          </div>
          <NButton size="small" quaternary class="ml-auto" @click="copyAddress">
            复制地址
          </NButton>
        </header>

        <!-- 中间区：集合态只滚文件列表，其他状态整体可滚动 -->
        <main
          class="flex flex-1 min-h-0 flex-col gap-4"
          :class="isCollectionReady ? 'overflow-hidden' : 'share-scroll'"
        >
          <!-- 加载：铺满中间内容区，转圈与提示居中 -->
          <div
            v-if="phase === 'loading'"
            class="relative flex flex-1 min-h-0 flex-col"
          >
            <ListLoading show :text="bootLoadingText" />
          </div>

          <ShareStatusEmpty
            v-else-if="isStatusPhase(phase)"
            :phase="phase"
            :error-text="errorText"
            @retry="init"
            @back="router.push('/files')"
          />

          <!-- 密码 / 打开：校验密码时遮罩在本区域内居中 -->
          <ShareGatePanel
            v-else-if="phase === 'gate' && info"
            v-model:password="password"
            :info="info"
            :password-error="passwordError"
            :expires-label="expiresLabel"
            :unlocking="unlocking"
            :rate-limited="rateLimited"
            :loading-text="unlockLoadingText"
            @unlock="unlock"
          />

          <!-- 已解锁：单文件 -->
          <ShareSingleFile
            v-else-if="phase === 'ready' && singleFile && info"
            :info="info"
            :file="singleFile"
            :single-size="singleSize"
            :single-missing="singleMissing"
            :src="singleSrc"
            :image-src="singleImageSrc"
            :download-src="singleDownloadSrc"
            @preview="openSinglePreview"
          />

          <!-- 已解锁：文件集合（卡片头尾固定，仅文件列表滚动） -->
          <ShareCollectionPanel
            v-else-if="phase === 'ready' && info"
            :files="collectionFiles"
            :root-id="collectionRootId"
            :category="collectionCategory"
            :loading="collectionLoading"
            :loading-text="collectionLoadingText"
            :error="collectionError"
            :missing-count="collectionMissingCount"
            :file-url="fileUrl"
            @refresh="refreshFiles"
            @preview="openCollectionPreview"
          />
        </main>

        <div
          v-if="phase === 'ready'"
          class="glass-chip shrink-0 px-3 py-2 flex items-start gap-2 text-11px text-ink-sub"
        >
          <NIcon :size="14" class="mt-0.5 shrink-0"
            ><ShieldCheckmarkOutline
          /></NIcon>
          <span>
            已成功解锁，本次访问已计数。文件访问令牌有效期 30
            分钟，过期后刷新页面重新打开即可（可能再消耗一次打开次数）。
          </span>
        </div>

        <p
          class="m-0 shrink-0 text-center text-11px text-ink-sub flex items-center justify-center gap-1"
        >
          <NIcon :size="12"><InformationCircleOutline /></NIcon>
          Vakao 静态资源中心 · 分享链接由文件所有者创建
        </p>
      </div>
    </div>

    <PreviewDialog
      v-model:show="previewShow"
      v-model:index="previewIndex"
      :files="previewTargets"
    />
  </PublicPage>
</template>

<style scoped>
/**
 * 公开分享页：锁一屏高，头尾固定，只有中间区滚动。
 * 100dvh 放在 100vh 之后，老浏览器回退到 100vh。
 * box-sizing 显式声明，避免安全区 padding 把高度撑出视口。
 */
.share-access-shell {
  box-sizing: border-box;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  padding-top: max(1.5rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
}

@media (min-width: 640px) {
  .share-access-shell {
    padding-top: max(2.5rem, env(safe-area-inset-top));
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
  }
}

.share-scroll {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
