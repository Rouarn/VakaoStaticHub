<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NIcon, NInput, useMessage } from 'naive-ui';
import {
  ArrowBackOutline,
  BanOutline,
  DocumentTextOutline,
  DownloadOutline,
  EyeOutline,
  InformationCircleOutline,
  LockClosedOutline,
  RefreshOutline,
  ShieldCheckmarkOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import { RequestError } from '@vakao-ui/axios';
import type { ShareInfo } from '@vakao/shared';
import {
  fetchShareCollection,
  getShareInfo,
  SHARE_TOKEN_RE,
  unlockShare,
} from '@/api/shares';
import type { ShareCollectionFile } from '@/api/shares';
import { buildShareFileUrl } from '@/utils/file-url';
import {
  formatBytes,
  getFileKind,
  isImage,
  isPreviewable,
} from '@/utils/file-types';
import { formatDateTime } from '@/utils/format';
import PublicPage from '@/components/common/public-page.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';

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

type Phase =
  | 'loading'
  | 'error'
  | 'notfound'
  | 'disabled'
  | 'gate'
  | 'expired'
  | 'exhausted'
  | 'ready';
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
/** 单文件分享的真实大小：ShareInfo 不含 size，用 HEAD 读 Content-Length */
const singleSize = ref<number | null>(null);
const singleMissing = ref(false);
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

async function init() {
  accessToken.value = '';
  info.value = null;
  collectionFiles.value = [];
  collectionRootId.value = '';
  collectionCategory.value = '';
  singleSize.value = null;
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
    if (info.value?.shareType === 'collection') await loadCollection();
    else await loadSingleMeta();
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

async function loadCollection() {
  collectionError.value = '';
  beginCollectionLoading();
  try {
    const result = await fetchShareCollection(token.value, accessToken.value);
    collectionFiles.value = result.files ?? [];
    collectionRootId.value = result.rootId ?? '';
    collectionCategory.value = result.category ?? '';
  } catch (e) {
    const { code, message } = errorOf(e);
    const text = joinMessage(message);
    const unavailable = code === 410 ? unavailablePhase(text) : null;
    if (unavailable) {
      phase.value = unavailable;
    } else if (code === 401) {
      collectionError.value =
        '访问令牌已过期（有效期 30 分钟），请刷新页面重新打开分享';
    } else {
      collectionError.value = text || '文件列表加载失败';
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

/**
 * 单文件分享没有独立的元信息接口，用 HEAD 读取 Content-Length。
 * 404 才判定「文件已删除」；网络失败保持未知，避免误报。
 */
async function loadSingleMeta() {
  singleSize.value = null;
  singleMissing.value = false;
  if (!singleFile.value) return;
  try {
    const res = await fetch(singleSrc.value, { method: 'HEAD' });
    if (res.status === 404) {
      singleMissing.value = true;
      return;
    }
    if (!res.ok) return;
    const length = Number(res.headers.get('content-length'));
    singleSize.value = Number.isFinite(length) ? length : null;
  } catch {
    /* 保留未知状态 */
  }
}

function nameOf(path: string) {
  return path.split('/').pop() ?? path;
}

/**
 * 单文件视图仅在 shareType==='file' 时渲染。
 * shareType 由后端按 filePaths 长度派生，是唯一的判定依据。
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
      size: singleSize.value ?? 0,
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
    size: file.size ?? 0,
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

          <!-- 链接不存在 -->
          <EmptyState
            v-else-if="phase === 'notfound'"
            :icon="DocumentTextOutline"
            title="分享链接不存在或已被撤销"
            description="请确认链接是否完整（token 为 32 位十六进制字符），或联系分享者重新生成。"
          >
            <NButton size="small" @click="router.push('/files')">
              <template #icon
                ><NIcon><ArrowBackOutline /></NIcon
              ></template>
              返回首页
            </NButton>
          </EmptyState>

          <!-- 加载失败 -->
          <EmptyState
            v-else-if="phase === 'error'"
            :icon="RefreshOutline"
            title="分享信息加载失败"
            :description="errorText"
          >
            <NButton size="small" type="primary" @click="init">
              <template #icon
                ><NIcon><RefreshOutline /></NIcon
              ></template>
              重试
            </NButton>
          </EmptyState>

          <!-- 已停用 -->
          <EmptyState
            v-else-if="phase === 'disabled'"
            :icon="BanOutline"
            title="分享链接已停用"
            description="分享者已停用该链接，无法继续访问。请联系分享者重新启用或重新创建链接。"
          />

          <!-- 已过期 -->
          <EmptyState
            v-else-if="phase === 'expired'"
            :icon="TimeOutline"
            title="分享链接已过期"
            description="该链接的有效期已结束，无法继续访问。请联系分享者重新创建并获取新链接。"
          />

          <!-- 次数用尽 -->
          <EmptyState
            v-else-if="phase === 'exhausted'"
            :icon="LockClosedOutline"
            title="分享链接打开次数已达上限"
            description="分享者设置了最大打开次数，当前次数已用尽。请联系分享者调整或重新创建链接。"
          />

          <!-- 密码 / 打开：校验密码时遮罩在本区域内居中 -->
          <div
            v-else-if="phase === 'gate' && info"
            class="relative flex flex-1 min-h-0 flex-col"
          >
            <section class="glass-panel px-5 py-6 flex flex-col gap-4">
              <div class="flex flex-col gap-1">
                <p class="m-0 text-14px font-600 text-ink">
                  {{
                    info.shareType === 'collection'
                      ? `文件集合（${info.filePaths.length} 个文件）`
                      : nameOf(info.filePaths[0])
                  }}
                </p>
                <p class="m-0 text-11px text-ink-sub">
                  {{ info.category }} · {{ expiresLabel }}
                  <template v-if="info.maxAccesses !== null">
                    · 最多打开 {{ info.maxAccesses }} 次</template
                  >
                </p>
              </div>

              <p
                v-if="passwordError"
                class="m-0 text-12px text-red-500 leading-5"
              >
                {{ passwordError }}
              </p>

              <form
                v-if="info.hasPassword"
                class="flex flex-col gap-2"
                @submit.prevent="unlock"
              >
                <label class="flex flex-col gap-1">
                  <span class="text-12px text-ink-sub">访问密码</span>
                  <NInput
                    v-model:value="password"
                    type="password"
                    show-password-on="click"
                    placeholder="请输入分享者设置的访问密码"
                    size="large"
                    :disabled="unlocking"
                    @keyup.enter="unlock"
                  />
                </label>
                <NButton
                  type="primary"
                  size="large"
                  attr-type="submit"
                  :loading="unlocking"
                  :disabled="rateLimited"
                >
                  <template #icon
                    ><NIcon><LockClosedOutline /></NIcon
                  ></template>
                  验证并打开
                </NButton>
              </form>

              <div v-else class="flex flex-col gap-2">
                <p class="m-0 text-12px text-ink-sub">
                  该分享未设置密码。打开会消耗 1
                  次打开次数（若分享者设置过上限）。
                </p>
                <NButton
                  type="primary"
                  size="large"
                  :loading="unlocking"
                  :disabled="rateLimited"
                  @click="unlock"
                >
                  <template #icon
                    ><NIcon><EyeOutline /></NIcon
                  ></template>
                  打开分享
                </NButton>
              </div>
            </section>
            <ListLoading :show="unlocking" :text="unlockLoadingText" />
          </div>

          <!-- 已解锁：单文件 -->
          <section
            v-else-if="phase === 'ready' && singleFile && info"
            class="glass-panel px-5 py-5 flex flex-col gap-4"
          >
            <div class="flex items-center gap-3">
              <div
                class="glass-chip w-11 h-11 flex items-center justify-center shrink-0"
              >
                <NIcon :size="22" class="text-brand-600 dark:text-brand-400">
                  <DocumentTextOutline />
                </NIcon>
              </div>
              <div class="min-w-0 flex-1">
                <p
                  class="m-0 text-14px font-600 text-ink truncate"
                  :title="singleFile.name"
                >
                  {{ singleFile.name }}
                </p>
                <p class="m-0 mt-0.5 text-11px text-ink-sub">
                  单文件分享 · {{ info.category }}
                  <template v-if="singleMissing">
                    ·
                    <span class="text-amber-600 dark:text-amber-400"
                      >文件已删除</span
                    >
                  </template>
                  <template v-else-if="singleSize !== null">
                    · {{ formatBytes(singleSize) }}
                  </template>
                </p>
              </div>
            </div>

            <img
              v-if="isImage(singleFile.name) && !singleMissing"
              :src="singleImageSrc"
              :alt="singleFile.name"
              class="max-h-64 w-auto mx-auto rounded-xl object-contain"
            />

            <div v-if="singleMissing" class="flex items-center gap-2">
              <span class="text-12px text-amber-600 dark:text-amber-400">
                文件已被删除，请联系分享者重新创建分享。
              </span>
            </div>

            <div v-else class="flex items-center gap-2 flex-wrap">
              <NButton
                v-if="isPreviewable(singleFile.name)"
                type="primary"
                size="small"
                @click="openSinglePreview"
              >
                <template #icon
                  ><NIcon><EyeOutline /></NIcon
                ></template>
                在线预览
              </NButton>
              <NButton
                tag="a"
                :href="singleDownloadSrc"
                size="small"
                :type="isPreviewable(singleFile.name) ? 'default' : 'primary'"
              >
                <template #icon
                  ><NIcon><DownloadOutline /></NIcon
                ></template>
                下载文件
              </NButton>
            </div>
          </section>

          <!-- 已解锁：文件集合（卡片头尾固定，仅文件列表滚动） -->
          <section
            v-else-if="phase === 'ready' && info"
            class="glass-panel px-5 py-5 flex flex-1 min-h-0 flex-col gap-3"
          >
            <!-- 卡片信息收成一行：标题、路径自适应截断，操作按钮右对齐 -->
            <div class="flex items-center gap-2 shrink-0">
              <p class="m-0 shrink-0 text-14px font-600 text-ink">
                文件集合
                <span class="text-11px text-ink-sub"
                  >（{{ collectionFiles.length }} 个）</span
                >
              </p>
              <p
                v-if="collectionCategory"
                class="m-0 min-w-0 flex-1 truncate text-11px text-ink-sub"
                :title="`${collectionRootId} / ${collectionCategory}`"
              >
                {{ collectionRootId }} / {{ collectionCategory }}
              </p>
              <NButton
                size="tiny"
                quaternary
                class="ml-auto shrink-0"
                @click="loadCollection"
              >
                <template #icon
                  ><NIcon><RefreshOutline /></NIcon
                ></template>
                刷新列表
              </NButton>
            </div>

            <div class="relative flex flex-1 min-h-0 flex-col">
              <div class="share-scroll flex flex-1 min-h-0 flex-col">
                <p
                  v-if="collectionError"
                  class="m-0 text-12px text-red-500 leading-5"
                >
                  {{ collectionError }}
                </p>
                <div
                  v-else-if="!collectionLoading && collectionFiles.length === 0"
                  class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-8 text-center text-12px text-ink-sub"
                >
                  文件集合为空：分享创建后文件可能已被全部删除，请联系分享者重新创建。
                </div>
                <div v-else class="flex flex-col gap-2">
                  <p
                    v-if="collectionMissingCount > 0"
                    class="m-0 text-11px text-amber-600 dark:text-amber-400"
                  >
                    有
                    {{ collectionMissingCount }}
                    个文件已被删除，已标记为不可预览/下载。
                  </p>
                  <ul class="m-0 p-0 list-none flex flex-col gap-2">
                    <li
                      v-for="(file, index) in collectionFiles"
                      :key="file.path"
                      class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/45 dark:bg-white/4 px-3 py-2.5 flex items-center gap-3"
                      :class="!file.exists ? 'opacity-60' : ''"
                    >
                      <div
                        class="glass-chip w-8 h-8 flex items-center justify-center shrink-0"
                      >
                        <NIcon
                          :size="16"
                          class="text-brand-600 dark:text-brand-400"
                        >
                          <DocumentTextOutline />
                        </NIcon>
                      </div>
                      <span class="min-w-0 flex-1">
                        <span
                          class="block text-12px text-ink truncate"
                          :title="file.path"
                        >
                          {{ file.name }}
                        </span>
                        <span
                          class="block text-11px text-ink-sub truncate"
                          :title="file.path"
                        >
                          {{ file.path }}
                          <template v-if="file.exists">
                            · {{ formatBytes(file.size ?? 0) }}</template
                          >
                        </span>
                      </span>
                      <span
                        v-if="!file.exists"
                        class="text-10px text-amber-600 dark:text-amber-400 shrink-0"
                      >
                        文件已删除
                      </span>
                      <span v-else class="text-10px text-ink-sub shrink-0">
                        {{ getFileKind(file.name) }}
                      </span>
                      <NButton
                        v-if="file.exists && isPreviewable(file.name)"
                        size="tiny"
                        quaternary
                        @click="openCollectionPreview(index)"
                      >
                        <template #icon
                          ><NIcon><EyeOutline /></NIcon
                        ></template>
                        预览
                      </NButton>
                      <NButton
                        v-if="file.exists"
                        tag="a"
                        :href="fileUrl(index, true)"
                        size="tiny"
                        quaternary
                      >
                        <template #icon
                          ><NIcon><DownloadOutline /></NIcon
                        ></template>
                        下载
                      </NButton>
                    </li>
                  </ul>
                </div>
              </div>
              <ListLoading
                :show="collectionLoading"
                :text="collectionLoadingText"
              />
            </div>
          </section>
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
