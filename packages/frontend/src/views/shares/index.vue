<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  NButton,
  NCheckbox,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPagination,
  NSelect,
  NSpin,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
  CopyOutline,
  DocumentTextOutline,
  EyeOutline,
  InformationCircleOutline,
  LinkOutline,
  QrCodeOutline,
  RefreshOutline,
  SearchOutline,
  ShareSocialOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { FileItem, ShareAccessLog, ShareLink } from '@vakao/shared';
import { RequestError } from '@vakao-ui/axios';
import {
  createShare,
  getSharePageUrl,
  listShareAccessLogs,
  listShares,
  revokeShare,
  SHARE_TOKEN_RE,
} from '@/api/shares';
import { listFiles } from '@/api/files';
import { getErrorMessage } from '@/utils/http';
import { formatBytes, formatTime } from '@/utils/file-types';
import { formatDateTime } from '@/utils/format';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import ShareQrModal from './components/share-qr-modal.vue';

/**
 * 分享链接管理
 *
 * 后端能力边界（本轮不改后端，UI 如实呈现）：
 * - GET /share/list 无分页参数 → 前端分页，页面显式标注
 * - 无编辑 / 停用接口，DELETE 即物理删除（含访问记录）
 * - 不支持目录分享，仅单文件或文件集合（collection）
 * - 分享记录无备注字段
 */
const appStore = useAppStore();
const categoryStore = useCategoryStore();
const message = useMessage();

const links = ref<ShareLink[]>([]);
const loading = ref(false);
const error = ref('');
const now = ref(Date.now());

const keyword = ref('');
const statusFilter = ref<'all' | 'active' | 'expired' | 'exhausted'>('all');
const page = ref(1);
const pageSize = ref(8);

function statusOf(link: ShareLink): 'active' | 'expired' | 'exhausted' {
  if (link.expiresAt !== null && link.expiresAt <= now.value) return 'expired';
  if (link.maxAccesses !== null && link.accessCount >= link.maxAccesses)
    return 'exhausted';
  return 'active';
}

const STATUS_TAG: Record<string, { label: string; type: 'success' | 'warning' | 'default' }> = {
  active: { label: '活跃', type: 'success' },
  expired: { label: '已过期', type: 'default' },
  exhausted: { label: '次数用尽', type: 'warning' },
};

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return links.value.filter((link) => {
    if (statusFilter.value !== 'all' && statusOf(link) !== statusFilter.value)
      return false;
    if (!kw) return true;
    const target =
      link.shareType === 'collection'
        ? (link.filePaths ?? []).join(' ')
        : link.filePath;
    return (
      link.token.toLowerCase().includes(kw) ||
      target.toLowerCase().includes(kw) ||
      link.category.toLowerCase().includes(kw)
    );
  });
});

const pagedLinks = computed(() =>
  filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

const counts = computed(() => {
  const result = { all: links.value.length, active: 0, expired: 0, exhausted: 0 };
  for (const link of links.value) result[statusOf(link)] += 1;
  return result;
});

const statusTabs = computed(() => [
  { key: 'all' as const, label: '全部', count: counts.value.all },
  { key: 'active' as const, label: '活跃', count: counts.value.active },
  { key: 'expired' as const, label: '已过期', count: counts.value.expired },
  { key: 'exhausted' as const, label: '次数用尽', count: counts.value.exhausted },
]);

async function load() {
  loading.value = true;
  error.value = '';
  now.value = Date.now();
  try {
    links.value = await listShares();
    page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
  } catch (e) {
    error.value = getErrorMessage(e, '分享列表加载失败');
    links.value = [];
  } finally {
    loading.value = false;
  }
}

watch(statusFilter, () => {
  page.value = 1;
});
watch(keyword, () => {
  page.value = 1;
});

function targetLabel(link: ShareLink) {
  if (link.shareType === 'collection') {
    return `文件集合（${(link.filePaths ?? []).length} 个文件）`;
  }
  return link.filePath.split('/').pop() ?? link.filePath;
}

// ===================== 创建分享 =====================
const createShow = ref(false);
const creating = ref(false);
const form = ref({
  rootId: '',
  category: '',
  password: '',
  expiresPreset: 0,
  customHours: 24,
  maxAccesses: null as number | null,
});
const selectedPaths = ref<string[]>([]);
const fileKeyword = ref('');
const filePage = ref(1);
const filePageSize = 100;
const fileItems = ref<FileItem[]>([]);
const fileTotal = ref(0);
const filesLoading = ref(false);
const filesError = ref('');

const roots = computed(() => categoryStore.roots);
const categories = computed(() => categoryStore.categoriesOf(form.value.rootId));
const selectedCount = computed(() => selectedPaths.value.length);

const expiryOptions = [
  { label: '永久有效', value: 0 },
  { label: '1 小时', value: 1 },
  { label: '1 天', value: 24 },
  { label: '7 天', value: 168 },
  { label: '30 天', value: 720 },
  { label: '自定义', value: -1 },
];

const filePages = computed(() =>
  Math.max(1, Math.ceil(fileTotal.value / filePageSize)),
);

/** 文件列表请求序号：打开弹窗时 root/category 的 watcher 会与 openCreate 并发触发同一 key 请求，
 * 客户端会取消先前请求；用序号丢弃过期结果，避免把「请求已取消」当作错误态展示 */
let filesSeq = 0;

async function loadFiles() {
  if (!form.value.rootId || !form.value.category) return;
  const seq = ++filesSeq;
  filesLoading.value = true;
  filesError.value = '';
  try {
    const result = await listFiles(form.value.rootId, form.value.category, {
      page: filePage.value,
      pageSize: filePageSize,
      q: fileKeyword.value.trim() || undefined,
      sort: 'mtime',
      order: 'desc',
    });
    if (seq !== filesSeq) return;
    fileItems.value = result.items;
    fileTotal.value = result.total;
  } catch (e) {
    if (seq !== filesSeq) return;
    if (e instanceof RequestError && e.type === 'cancel') return;
    filesError.value = getErrorMessage(e, '文件列表加载失败');
    fileItems.value = [];
    fileTotal.value = 0;
  } finally {
    if (seq === filesSeq) filesLoading.value = false;
  }
}

watch(
  fileKeyword,
  useDebounceFn(() => {
    filePage.value = 1;
    void loadFiles();
  }, 300),
);

watch(filePage, () => void loadFiles());

function resetForm() {
  form.value = {
    rootId: appStore.activeRootId || roots.value[0]?.id || '',
    category: categoryStore.activeCategory ?? '',
    password: '',
    expiresPreset: 0,
    customHours: 24,
    maxAccesses: null,
  };
  selectedPaths.value = [];
  fileKeyword.value = '';
  filePage.value = 1;
  fileItems.value = [];
  fileTotal.value = 0;
  filesError.value = '';
}

async function openCreate() {
  resetForm();
  if (roots.value.length === 0) await categoryStore.loadRoots();
  if (!form.value.rootId) form.value.rootId = roots.value[0]?.id ?? '';
  if (form.value.rootId && categories.value.length === 0) {
    await categoryStore.loadCategories(form.value.rootId);
  }
  if (!form.value.category) form.value.category = categories.value[0]?.name ?? '';
  createShow.value = true;
  await loadFiles();
}

watch(
  () => form.value.rootId,
  async (rootId) => {
    if (!rootId) return;
    if (categoryStore.categoriesOf(rootId).length === 0) {
      await categoryStore.loadCategories(rootId);
    }
    form.value.category = categories.value[0]?.name ?? '';
  },
);

watch(
  () => form.value.category,
  () => {
    selectedPaths.value = [];
    filePage.value = 1;
    void loadFiles();
  },
);

function togglePath(path: string) {
  selectedPaths.value = selectedPaths.value.includes(path)
    ? selectedPaths.value.filter((p) => p !== path)
    : [...selectedPaths.value, path];
}

const allOnPageSelected = computed(
  () =>
    fileItems.value.length > 0 &&
    fileItems.value.every((f) => selectedPaths.value.includes(f.path)),
);

function toggleAllOnPage() {
  if (allOnPageSelected.value) {
    selectedPaths.value = selectedPaths.value.filter(
      (p) => !fileItems.value.some((f) => f.path === p),
    );
  } else {
    selectedPaths.value = [
      ...new Set([...selectedPaths.value, ...fileItems.value.map((f) => f.path)]),
    ];
  }
}

async function submitCreate() {
  if (selectedPaths.value.length === 0) {
    message.warning('请至少选择一个文件');
    return;
  }
  const preset = form.value.expiresPreset;
  const expiresInMs =
    preset > 0
      ? preset * 3_600_000
      : preset === -1
        ? form.value.customHours * 3_600_000
        : undefined;
  if (preset === -1 && (!form.value.customHours || form.value.customHours <= 0)) {
    message.warning('自定义有效期必须大于 0 小时');
    return;
  }
  creating.value = true;
  try {
    const isCollection = selectedPaths.value.length > 1;
    const result = await createShare({
      rootId: form.value.rootId,
      category: form.value.category,
      filePath: selectedPaths.value[0],
      shareType: isCollection ? 'collection' : 'file',
      ...(isCollection ? { filePaths: selectedPaths.value } : {}),
      ...(expiresInMs ? { expiresInMs } : {}),
      ...(form.value.maxAccesses ? { maxAccesses: form.value.maxAccesses } : {}),
      ...(form.value.password.trim() ? { password: form.value.password.trim() } : {}),
    });
    createShow.value = false;
    message.success('分享链接已创建');
    await load();
    qrUrl.value = getSharePageUrl(result.token);
    qrShow.value = true;
  } catch (e) {
    message.error(getErrorMessage(e, '创建分享失败'));
  } finally {
    creating.value = false;
  }
}

// ===================== 链接操作 =====================
const qrShow = ref(false);
const qrUrl = ref('');

async function copyUrl(token: string) {
  try {
    await navigator.clipboard.writeText(getSharePageUrl(token));
    message.success('分享链接已复制');
  } catch {
    message.error('复制失败，请检查浏览器剪贴板权限');
  }
}

function openQr(token: string) {
  qrUrl.value = getSharePageUrl(token);
  qrShow.value = true;
}

const logsShow = ref(false);
const logsLoading = ref(false);
const logsError = ref('');
const logsLink = ref<ShareLink | null>(null);
const logs = ref<ShareAccessLog[]>([]);

async function openLogs(link: ShareLink) {
  logsLink.value = link;
  logsShow.value = true;
  logsLoading.value = true;
  logsError.value = '';
  logs.value = [];
  try {
    logs.value = await listShareAccessLogs(link.token);
  } catch (e) {
    logsError.value = getErrorMessage(e, '访问记录加载失败');
  } finally {
    logsLoading.value = false;
  }
}

function retryLogs() {
  if (logsLink.value) void openLogs(logsLink.value);
}

const revokeShow = ref(false);
const revoking = ref(false);
const revokeTarget = ref<ShareLink | null>(null);

function openRevoke(link: ShareLink) {
  revokeTarget.value = link;
  revokeShow.value = true;
}

async function confirmRevoke() {
  const target = revokeTarget.value;
  if (!target) return;
  revoking.value = true;
  try {
    await revokeShare(target.token);
    message.success('分享链接已撤销');
    revokeShow.value = false;
    await load();
  } catch (e) {
    message.error(getErrorMessage(e, '撤销失败'));
  } finally {
    revoking.value = false;
  }
}

function isTokenValid(token: string) {
  return SHARE_TOKEN_RE.test(token);
}

onMounted(async () => {
  if (categoryStore.roots.length === 0) await categoryStore.loadRoots();
  await load();
});
</script>

<template>
  <div class="flex flex-col gap-4 animate-fade-up">
    <PageHeader
      title="分享管理"
      description="创建与管理公开分享链接；访问者凭链接在 /share/:token 页面访问文件"
      :icon="ShareSocialOutline"
    >
      <template #actions>
        <NTooltip :delay="300">
          <template #trigger>
            <NButton size="small" quaternary circle @click="load">
              <template #icon><NIcon><RefreshOutline /></NIcon></template>
            </NButton>
          </template>
          刷新
        </NTooltip>
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon><NIcon><AddOutline /></NIcon></template>
          创建分享
        </NButton>
      </template>
    </PageHeader>

    <div class="glass-chip self-start px-3 py-1.5 flex items-center gap-1.5 text-11px text-ink-sub">
      <NIcon :size="14"><InformationCircleOutline /></NIcon>
      后端 /share/list 无分页参数，本页为前端分页；撤销即删除记录（无停用/编辑接口）
    </div>

    <!-- 工具条 -->
    <header class="glass-panel px-4 py-3 flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-1 flex-wrap">
        <button
          v-for="tab in statusTabs"
          :key="tab.key"
          class="px-2.5 py-1 rounded-full text-12px transition-colors cursor-pointer border-none"
          :class="
            statusFilter === tab.key
              ? 'bg-brand-600 text-white'
              : 'bg-white/50 dark:bg-white/8 text-ink-sub hover:text-brand-600 dark:hover:text-brand-400'
          "
          @click="statusFilter = tab.key"
        >
          {{ tab.label }}
          <span class="tabular-nums opacity-80">{{ tab.count }}</span>
        </button>
      </div>

      <NInput
        v-model:value="keyword"
        size="small"
        clearable
        placeholder="搜索 token / 文件 / 分类"
        class="w-64 ml-auto"
      >
        <template #prefix><NIcon :size="15"><SearchOutline /></NIcon></template>
      </NInput>
    </header>

    <NSpin :show="loading">
      <ErrorState v-if="error" :message="error" @retry="load" />

      <EmptyState
        v-else-if="!loading && filtered.length === 0"
        :icon="LinkOutline"
        :title="links.length === 0 ? '还没有分享链接' : '没有符合条件的分享'"
        :description="
          links.length === 0
            ? '把文件库里的文件生成公开链接，发给同事或外部协作者即可直接访问与下载。'
            : '调整状态筛选或清空搜索关键词后再试。'
        "
      >
        <NButton v-if="links.length === 0" type="primary" size="small" @click="openCreate">
          创建第一个分享
        </NButton>
        <NButton v-else size="small" @click="keyword = ''; statusFilter = 'all'">
          清空筛选
        </NButton>
      </EmptyState>

      <div v-else class="flex flex-col gap-3">
        <article
          v-for="link in pagedLinks"
          :key="link.token"
          class="glass-panel px-4 py-3 flex flex-col gap-3"
        >
          <div class="flex items-start gap-3 flex-wrap">
            <div class="glass-chip w-9 h-9 flex items-center justify-center shrink-0">
              <NIcon :size="18" class="text-brand-600 dark:text-brand-400">
                <LinkOutline />
              </NIcon>
            </div>

            <div class="min-w-0 flex-1">
              <p class="m-0 text-13px font-600 text-ink truncate" :title="targetLabel(link)">
                {{ targetLabel(link) }}
              </p>
              <p class="m-0 mt-0.5 text-11px text-ink-sub truncate">
                {{ link.category }} · 创建于 {{ formatDateTime(link.createdAt) }}
              </p>
            </div>

            <div class="flex items-center gap-2 flex-wrap">
              <NTag size="small" :type="STATUS_TAG[statusOf(link)].type" :bordered="false">
                {{ STATUS_TAG[statusOf(link)].label }}
              </NTag>
              <NTag v-if="link.hasPassword" size="small" :bordered="false">密码保护</NTag>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-11px text-ink-sub">
            <span>
              打开 <span class="text-ink font-600 tabular-nums">{{ link.accessCount }}</span>
              <template v-if="link.maxAccesses !== null"> / {{ link.maxAccesses }}</template>
              次
            </span>
            <span>
              {{ link.expiresAt ? `有效期至 ${formatDateTime(link.expiresAt)}` : '永久有效' }}
            </span>
            <span class="font-mono" :title="link.token">
              token {{ link.token.slice(0, 8) }}…{{ link.token.slice(-6) }}
              <span v-if="!isTokenValid(link.token)" class="text-red-500 ml-1">格式异常</span>
            </span>
          </div>

          <div class="flex items-center gap-1.5 flex-wrap">
            <NButton size="tiny" @click="copyUrl(link.token)">
              <template #icon><NIcon><CopyOutline /></NIcon></template>
              复制链接
            </NButton>
            <NButton size="tiny" @click="openQr(link.token)">
              <template #icon><NIcon><QrCodeOutline /></NIcon></template>
              二维码
            </NButton>
            <NButton size="tiny" @click="openLogs(link)">
              <template #icon><NIcon><EyeOutline /></NIcon></template>
              访问记录
              <span class="ml-1 tabular-nums text-ink-sub">{{ link.accessCount }}</span>
            </NButton>
            <NButton size="tiny" quaternary type="error" class="ml-auto" @click="openRevoke(link)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>
              撤销
            </NButton>
          </div>
        </article>

        <footer class="glass-panel px-4 py-2 flex flex-wrap items-center justify-end gap-2">
          <span class="mr-auto text-11px text-ink-sub">
            共 {{ filtered.length }} 条 · 前端分页
          </span>
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="filtered.length"
            :page-sizes="[8, 16, 32, 64]"
            show-size-picker
          />
        </footer>
      </div>
    </NSpin>

    <!-- 创建分享 -->
    <NModal
      v-model:show="createShow"
      preset="card"
      title="创建分享链接"
      class="w-720px! max-w-[94vw]"
      :bordered="false"
    >
      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">资源根目录</span>
            <NSelect
              v-model:value="form.rootId"
              size="small"
              :options="roots.map((r) => ({ label: r.name, value: r.id }))"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">分类</span>
            <NSelect
              v-model:value="form.category"
              size="small"
              :options="categories.map((c) => ({ label: `${c.name}（${c.fileCount}）`, value: c.name }))"
            />
          </label>
        </div>

        <!-- 文件选择 -->
        <section class="flex flex-col gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-12px text-ink-sub">
              选择文件
              <span v-if="selectedCount" class="text-brand-600 dark:text-brand-400 font-600">
                已选 {{ selectedCount }} 个
              </span>
            </span>
            <NInput
              v-model:value="fileKeyword"
              size="tiny"
              clearable
              placeholder="搜索文件名"
              class="w-48 ml-auto"
            >
              <template #prefix><NIcon :size="13"><SearchOutline /></NIcon></template>
            </NInput>
            <NButton size="tiny" quaternary @click="toggleAllOnPage">
              {{ allOnPageSelected ? '取消本页' : '全选本页' }}
            </NButton>
          </div>

          <div
            class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/40 dark:bg-white/4 min-h-40 max-h-64 overflow-y-auto"
          >
            <NSpin :show="filesLoading">
              <div v-if="filesError" class="p-4 text-12px text-ink-sub">
                {{ filesError }}
                <NButton size="tiny" class="ml-2" @click="loadFiles">重试</NButton>
              </div>
              <div
                v-else-if="!filesLoading && fileItems.length === 0"
                class="p-6 text-center text-12px text-ink-sub"
              >
                当前分类没有文件，请先在文件库上传
              </div>
              <label
                v-for="file in fileItems"
                v-else
                :key="file.path"
                class="flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-glass-border/50 dark:border-glass-border-dark/50 last:border-b-0 hover:bg-brand-500/6"
              >
                <NCheckbox
                  :checked="selectedPaths.includes(file.path)"
                  @update:checked="togglePath(file.path)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-12px text-ink truncate" :title="file.path">
                    {{ file.name }}
                  </span>
                  <span class="block text-11px text-ink-sub">
                    {{ formatBytes(file.size) }} · {{ formatTime(file.mtime) }}
                  </span>
                </span>
              </label>
            </NSpin>
          </div>

          <div v-if="filePages > 1" class="flex items-center justify-end gap-2 text-11px text-ink-sub">
            <span>{{ filePage }} / {{ filePages }}</span>
            <NButton
              size="tiny"
              quaternary
              :disabled="filePage <= 1"
              @click="filePage -= 1"
            >
              <template #icon><NIcon><ChevronBackOutline /></NIcon></template>
            </NButton>
            <NButton
              size="tiny"
              quaternary
              :disabled="filePage >= filePages"
              @click="filePage += 1"
            >
              <template #icon><NIcon><ChevronForwardOutline /></NIcon></template>
            </NButton>
          </div>
        </section>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">访问密码（可选）</span>
            <NInput
              v-model:value="form.password"
              size="small"
              type="password"
              show-password-on="click"
              placeholder="留空则无需密码"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">有效期</span>
            <NSelect
              v-model:value="form.expiresPreset"
              size="small"
              :options="expiryOptions"
            />
          </label>
          <label v-if="form.expiresPreset === -1" class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">自定义小时</span>
            <NInputNumber
              v-model:value="form.customHours"
              size="small"
              :min="1"
              :max="8760"
              placeholder="小时"
            />
          </label>
          <label v-else class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">最大打开次数（可选）</span>
            <NInputNumber
              v-model:value="form.maxAccesses"
              size="small"
              :min="1"
              :max="1000000"
              placeholder="留空则不限制"
            />
          </label>
        </div>

        <p
          class="m-0 text-11px text-ink-sub flex items-start gap-1.5"
        >
          <NIcon :size="13" class="mt-0.5 shrink-0"><InformationCircleOutline /></NIcon>
          <span>
            打开次数按「成功解锁」计数，解锁后下载文件不重复计数；后端暂不支持目录分享与备注字段，
            多文件请在这里多选（生成文件集合），备注需求需后端扩展。
          </span>
        </p>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <NButton size="small" @click="createShow = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="creating"
            :disabled="selectedCount === 0"
            @click="submitCreate"
          >
            创建分享
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 二维码 -->
    <ShareQrModal
      v-model:show="qrShow"
      :url="qrUrl"
      :filename="`share-${qrUrl.split('/').pop() ?? 'qr'}.png`"
    />

    <!-- 访问记录 -->
    <NModal
      v-model:show="logsShow"
      preset="card"
      title="访问记录"
      class="w-640px! max-w-[94vw]"
      :bordered="false"
    >
      <p class="m-0 mb-3 text-11px text-ink-sub font-mono break-all">
        {{ logsLink?.token }}
      </p>
      <NSpin :show="logsLoading">
        <ErrorState v-if="logsError" :message="logsError" @retry="retryLogs" />
        <EmptyState
          v-else-if="!logsLoading && logs.length === 0"
          :icon="DocumentTextOutline"
          title="暂无访问记录"
          description="链接被成功解锁后，这里会记录访问时间、IP 与 User-Agent。解锁失败不会计数。"
        />
        <ul v-else class="m-0 p-0 list-none flex flex-col gap-2 max-h-100 overflow-y-auto">
          <li
            v-for="log in logs"
            :key="log.id"
            class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/45 dark:bg-white/4 px-3 py-2"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-12px text-ink font-600 tabular-nums">
                {{ formatDateTime(log.accessedAt) }}
              </span>
              <span class="text-11px text-ink-sub">{{ log.ip ?? 'IP 未知' }}</span>
            </div>
            <p class="m-0 mt-1 text-10px text-ink-sub break-all">
              {{ log.userAgent ?? 'UA 未记录' }}
            </p>
          </li>
        </ul>
      </NSpin>
    </NModal>

    <ConfirmModal
      v-model:show="revokeShow"
      title="撤销分享链接"
      :content="`撤销后链接立即失效，访问记录一并删除且不可恢复。\n目标：${revokeTarget ? targetLabel(revokeTarget) : ''}`"
      positive-text="确认撤销"
      :loading="revoking"
      @confirm="confirmRevoke"
    />
  </div>
</template>
