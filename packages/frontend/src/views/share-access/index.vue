<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NIcon,
  NInput,
  NSpin,
  useMessage,
} from 'naive-ui';
import {
  ArrowBackOutline,
  DocumentTextOutline,
  DownloadOutline,
  EyeOutline,
  InformationCircleOutline,
  LockClosedOutline,
  RefreshOutline,
  ShareSocialOutline,
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
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';

/**
 * 公开分享访问页
 *
 * 关键点：
 * - 使用 publicHttp，避免「密码错误 401」触发全局清态跳登录
 * - 10 次/分钟限流（429）与密码错误（401）分开提示，绝不误导为密码错误
 * - 过期 / 次数用尽给出明确独立状态
 * - 解锁后凭 accessToken 访问文件，不再消耗打开次数
 */
const route = useRoute();
const router = useRouter();
const message = useMessage();

const token = computed(() => String(route.params.token ?? ''));
const tokenValid = computed(() => SHARE_TOKEN_RE.test(token.value));

type Phase = 'loading' | 'error' | 'notfound' | 'gate' | 'expired' | 'exhausted' | 'ready';
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
const collectionLoading = ref(false);
const collectionError = ref('');
const collectionMissingCount = computed(
  () => collectionFiles.value.filter((file) => !file.exists).length,
);

const isExpiredByTime = computed(
  () => info.value?.expiresAt !== null && info.value?.expiresAt !== undefined && info.value.expiresAt <= Date.now(),
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
        (e.response?.data as { message?: string | string[] } | undefined)?.message ?? '',
    };
  }
  return { code: undefined, message: e instanceof Error ? e.message : '' };
}

function joinMessage(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.filter(Boolean).join('；');
  return value ?? '';
}

async function init() {
  accessToken.value = '';
  info.value = null;
  collectionFiles.value = [];
  collectionRootId.value = '';
  collectionCategory.value = '';
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
    const result = await unlockShare(token.value, password.value.trim() || undefined);
    accessToken.value = result.accessToken;
    password.value = '';
    phase.value = 'ready';
    if (info.value?.shareType === 'collection') await loadCollection();
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
    if (text.includes('已过期')) {
      phase.value = 'expired';
      return;
    }
    if (text.includes('次数已达上限') || text.includes('打开次数已达上限')) {
      phase.value = 'exhausted';
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
  collectionLoading.value = true;
  collectionError.value = '';
  try {
    const result = await fetchShareCollection(token.value, accessToken.value);
    collectionFiles.value = result.files ?? [];
    collectionRootId.value = result.rootId ?? '';
    collectionCategory.value = result.category ?? '';
  } catch (e) {
    const { code, message } = errorOf(e);
    const text = joinMessage(message);
    if (code === 401) {
      collectionError.value = '访问令牌已过期（有效期 30 分钟），请刷新页面重新打开分享';
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

const singleSrc = computed(() =>
  buildShareFileUrl(token.value, { accessToken: accessToken.value }),
);
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

function openSinglePreview() {
  if (!singleFile.value) return;
  previewTargets.value = [
    {
      filename: singleFile.value.name,
      src: singleSrc.value,
      downloadSrc: singleDownloadSrc.value,
      size: 0,
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
    src: fileUrl(i),
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
    <div class="min-h-full flex flex-col items-center px-4 py-8 sm:py-14">
      <div class="w-full max-w-2xl flex flex-col gap-4">
        <!-- 页头 -->
        <header class="glass-panel px-5 py-4 flex items-center gap-3">
          <div class="glass-chip w-10 h-10 flex items-center justify-center shrink-0">
            <NIcon :size="21" class="text-brand-600 dark:text-brand-400">
              <ShareSocialOutline />
            </NIcon>
          </div>
          <div class="min-w-0">
            <h1 class="m-0 text-15px font-600 text-ink leading-tight">文件分享</h1>
            <p class="m-0 mt-1 text-11px text-ink-sub truncate">
              token {{ token.slice(0, 8) }}…{{ token.slice(-6) }}
            </p>
          </div>
          <NButton size="tiny" quaternary class="ml-auto" @click="copyAddress">
            复制地址
          </NButton>
        </header>

        <!-- 加载 -->
        <div v-if="phase === 'loading'" class="glass-panel px-6 py-16 flex flex-col items-center gap-3">
          <NSpin size="medium" />
          <p class="m-0 text-12px text-ink-sub">正在读取分享信息…</p>
        </div>

        <!-- 链接不存在 -->
        <EmptyState
          v-else-if="phase === 'notfound'"
          :icon="DocumentTextOutline"
          title="分享链接不存在或已被撤销"
          description="请确认链接是否完整（token 为 32 位十六进制字符），或联系分享者重新生成。"
        >
          <NButton size="small" @click="router.push('/files')">
            <template #icon><NIcon><ArrowBackOutline /></NIcon></template>
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
            <template #icon><NIcon><RefreshOutline /></NIcon></template>
            重试
          </NButton>
        </EmptyState>

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

        <!-- 密码 / 打开 -->
        <section v-else-if="phase === 'gate' && info" class="glass-panel px-5 py-6 flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <p class="m-0 text-14px font-600 text-ink">
              {{ info.shareType === 'collection'
                ? `文件集合（${info.filePaths.length} 个文件）`
                : nameOf(info.filePaths[0]) }}
            </p>
            <p class="m-0 text-11px text-ink-sub">
              {{ info.category }} · {{ expiresLabel }}
              <template v-if="info.maxAccesses !== null"> · 最多打开 {{ info.maxAccesses }} 次</template>
            </p>
          </div>

          <p v-if="passwordError" class="m-0 text-12px text-red-500 leading-5">
            {{ passwordError }}
          </p>

          <form v-if="info.hasPassword" class="flex flex-col gap-2" @submit.prevent="unlock">
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
              <template #icon><NIcon><LockClosedOutline /></NIcon></template>
              验证并打开
            </NButton>
          </form>

          <div v-else class="flex flex-col gap-2">
            <p class="m-0 text-12px text-ink-sub">
              该分享未设置密码。打开会消耗 1 次打开次数（若分享者设置过上限）。
            </p>
            <NButton
              type="primary"
              size="large"
              :loading="unlocking"
              :disabled="rateLimited"
              @click="unlock"
            >
              <template #icon><NIcon><EyeOutline /></NIcon></template>
              打开分享
            </NButton>
          </div>
        </section>

        <!-- 已解锁 -->
        <template v-else-if="phase === 'ready' && info">
          <!-- 单文件 -->
          <section v-if="singleFile" class="glass-panel px-5 py-5 flex flex-col gap-4">
            <div class="flex items-center gap-3">
              <div class="glass-chip w-11 h-11 flex items-center justify-center shrink-0">
                <NIcon :size="22" class="text-brand-600 dark:text-brand-400">
                  <DocumentTextOutline />
                </NIcon>
              </div>
              <div class="min-w-0 flex-1">
                <p class="m-0 text-14px font-600 text-ink truncate" :title="singleFile.name">
                  {{ singleFile.name }}
                </p>
                <p class="m-0 mt-0.5 text-11px text-ink-sub">
                  单文件分享 · {{ info.category }}
                </p>
              </div>
            </div>

            <img
              v-if="isImage(singleFile.name)"
              :src="singleSrc"
              :alt="singleFile.name"
              class="max-h-64 w-auto mx-auto rounded-xl object-contain"
            />

            <div class="flex items-center gap-2 flex-wrap">
              <NButton
                v-if="isPreviewable(singleFile.name)"
                type="primary"
                size="small"
                @click="openSinglePreview"
              >
                <template #icon><NIcon><EyeOutline /></NIcon></template>
                在线预览
              </NButton>
              <NButton
                tag="a"
                :href="singleDownloadSrc"
                size="small"
                :type="isPreviewable(singleFile.name) ? 'default' : 'primary'"
              >
                <template #icon><NIcon><DownloadOutline /></NIcon></template>
                下载文件
              </NButton>
            </div>
          </section>

          <!-- 文件集合 -->
          <section v-else class="glass-panel px-5 py-5 flex flex-col gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="m-0 text-14px font-600 text-ink">
                文件集合
                <span class="text-11px text-ink-sub">（{{ collectionFiles.length }} 个）</span>
              </p>
              <NButton size="tiny" quaternary class="ml-auto" @click="loadCollection">
                <template #icon><NIcon><RefreshOutline /></NIcon></template>
                刷新列表
              </NButton>
            </div>

            <p v-if="collectionCategory" class="m-0 text-11px text-ink-sub truncate">
              {{ collectionRootId }} / {{ collectionCategory }}
            </p>

            <NSpin :show="collectionLoading">
              <p v-if="collectionError" class="m-0 text-12px text-red-500 leading-5">
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
                  有 {{ collectionMissingCount }} 个文件已被删除，已标记为不可预览/下载。
                </p>
                <ul class="m-0 p-0 list-none flex flex-col gap-2">
                  <li
                    v-for="(file, index) in collectionFiles"
                    :key="file.path"
                    class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/45 dark:bg-white/4 px-3 py-2.5 flex items-center gap-3"
                    :class="!file.exists ? 'opacity-60' : ''"
                  >
                    <div class="glass-chip w-8 h-8 flex items-center justify-center shrink-0">
                      <NIcon :size="16" class="text-brand-600 dark:text-brand-400">
                        <DocumentTextOutline />
                      </NIcon>
                    </div>
                    <span class="min-w-0 flex-1">
                      <span class="block text-12px text-ink truncate" :title="file.path">
                        {{ file.name }}
                      </span>
                      <span class="block text-10px text-ink-sub truncate">
                        {{ file.path }}
                        <template v-if="file.exists"> · {{ formatBytes(file.size ?? 0) }}</template>
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
                      <template #icon><NIcon><EyeOutline /></NIcon></template>
                      预览
                    </NButton>
                    <NButton
                      v-if="file.exists"
                      tag="a"
                      :href="fileUrl(index, true)"
                      size="tiny"
                      quaternary
                    >
                      <template #icon><NIcon><DownloadOutline /></NIcon></template>
                      下载
                    </NButton>
                  </li>
                </ul>
              </div>
            </NSpin>
          </section>

          <div class="glass-chip px-3 py-2 flex items-start gap-2 text-11px text-ink-sub">
            <NIcon :size="14" class="mt-0.5 shrink-0"><ShieldCheckmarkOutline /></NIcon>
            <span>
              已成功解锁，本次访问已计数。文件访问令牌有效期 30 分钟，过期后刷新页面重新打开即可（可能再消耗一次打开次数）。
            </span>
          </div>
        </template>

        <p class="m-0 text-center text-10px text-ink-sub flex items-center justify-center gap-1">
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
