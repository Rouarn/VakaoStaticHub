<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  NButton,
  NCheckbox,
  NDatePicker,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPagination,
  NSelect,
  NSpin,
  NSwitch,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
  CopyOutline,
  CreateOutline,
  DocumentTextOutline,
  EyeOutline,
  InformationCircleOutline,
  LinkOutline,
  PauseCircleOutline,
  PlayCircleOutline,
  QrCodeOutline,
  RefreshOutline,
  SearchOutline,
  ShareSocialOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  FileItem,
  ShareAccessLog,
  ShareLink,
  ShareLinkStatus,
  ShareListResult,
  UpdateShareLinkParams,
} from '@vakao/shared';
import { RequestError } from '@vakao-ui/axios';
import {
  createShare,
  getSharePageUrl,
  listShareAccessLogs,
  listShares,
  revokeShare,
  SHARE_TOKEN_RE,
  updateShare,
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
 * 服务端能力：
 * - GET /share/list 服务端分页 + 关键字 + 状态 counts
 * - PATCH /share/:token 编辑备注 / 有效期 / 密码 / 次数上限 / 启停
 * - DELETE /share/:token 物理删除（含访问记录）
 * - 仅支持单文件与文件集合；整目录分享暂不支持
 */
const appStore = useAppStore();
const categoryStore = useCategoryStore();
const message = useMessage();

const result = ref<ShareListResult | null>(null);
const loading = ref(false);
const error = ref('');
const now = ref(Date.now());

const keyword = ref('');
const statusFilter = ref<'all' | ShareLinkStatus>('all');
const page = ref(1);
const pageSize = ref(8);

const links = computed(() => result.value?.items ?? []);
const total = computed(() => result.value?.total ?? 0);
const counts = computed(
  () =>
    result.value?.counts ?? {
      all: 0,
      active: 0,
      expired: 0,
      exhausted: 0,
      disabled: 0,
    },
);

function statusOf(link: ShareLink): ShareLinkStatus {
  if (!link.enabled) return 'disabled';
  if (link.expiresAt !== null && link.expiresAt <= now.value) return 'expired';
  if (link.maxAccesses !== null && link.accessCount >= link.maxAccesses)
    return 'exhausted';
  return 'active';
}

const STATUS_TAG: Record<
  ShareLinkStatus,
  { label: string; type: 'success' | 'warning' | 'default' | 'error' }
> = {
  active: { label: '活跃', type: 'success' },
  expired: { label: '已过期', type: 'default' },
  exhausted: { label: '次数用尽', type: 'warning' },
  disabled: { label: '已停用', type: 'error' },
};

const statusTabs = computed(() => [
  { key: 'all' as const, label: '全部', count: counts.value.all },
  { key: 'active' as const, label: '活跃', count: counts.value.active },
  { key: 'expired' as const, label: '已过期', count: counts.value.expired },
  { key: 'exhausted' as const, label: '次数用尽', count: counts.value.exhausted },
  { key: 'disabled' as const, label: '已停用', count: counts.value.disabled },
]);

/** 请求序号：分页 / 筛选可能并发触发同一 key 请求，用序号丢弃过期与取消结果 */
let shareSeq = 0;

async function load(allowClamp = true) {
  const seq = ++shareSeq;
  loading.value = true;
  error.value = '';
  now.value = Date.now();
  try {
    const data = await listShares({
      page: page.value,
      pageSize: pageSize.value,
      ...(keyword.value.trim() ? { q: keyword.value.trim() } : {}),
      ...(statusFilter.value !== 'all' ? { status: statusFilter.value } : {}),
    });
    if (seq !== shareSeq) return;
    result.value = data;
    const maxPage = Math.max(1, Math.ceil(data.total / pageSize.value));
    if (allowClamp && page.value > maxPage) {
      page.value = maxPage;
      await load(false);
    }
  } catch (e) {
    if (seq !== shareSeq) return;
    if (e instanceof RequestError && e.type === 'cancel') return;
    error.value = getErrorMessage(e, '分享列表加载失败');
    result.value = null;
  } finally {
    if (seq === shareSeq) loading.value = false;
  }
}

/** 筛选变化后回到第一页并重新拉取（已在第一页时直接请求，避免 page watcher 不触发） */
function resetAndReload() {
  if (page.value === 1) void load();
  else page.value = 1;
}

watch(page, () => void load());
watch(pageSize, resetAndReload);
watch(statusFilter, resetAndReload);
watch(
  keyword,
  useDebounceFn(resetAndReload, 300),
);

function targetLabel(link: ShareLink) {
  if (link.shareType === 'collection') {
    return `文件集合（${link.filePaths.length} 个文件）`;
  }
  const path = link.filePaths[0];
  return path.split('/').pop() ?? path;
}

// ===================== 创建分享 =====================
const createShow = ref(false);
const creating = ref(false);
const form = ref({
  rootId: '',
  category: '',
  remark: '',
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
    remark: '',
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
    const result = await createShare({
      rootId: form.value.rootId,
      category: form.value.category,
      filePaths: selectedPaths.value,
      ...(form.value.remark.trim() ? { remark: form.value.remark.trim() } : {}),
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

// ===================== 编辑 / 启停 =====================
const editShow = ref(false);
const editSaving = ref(false);
const editTarget = ref<ShareLink | null>(null);
const editForm = ref({
  remark: '',
  expiresAt: null as number | null,
  password: '',
  clearPassword: false,
  maxAccesses: null as number | null,
  enabled: true,
});

function openEdit(link: ShareLink) {
  editTarget.value = link;
  editForm.value = {
    remark: link.remark ?? '',
    expiresAt: link.expiresAt,
    password: '',
    clearPassword: false,
    maxAccesses: link.maxAccesses,
    enabled: link.enabled,
  };
  editShow.value = true;
}

async function submitEdit() {
  const target = editTarget.value;
  if (!target) return;
  const next = editForm.value;
  const body: UpdateShareLinkParams = {};

  const remark = next.remark.trim() || null;
  if (remark !== (target.remark ?? null)) body.remark = remark;
  // 仅在发生变化时提交，避免把已过期的历史时间原样回传被后端拒绝
  if (next.expiresAt !== target.expiresAt) body.expiresAt = next.expiresAt;
  if (next.maxAccesses !== target.maxAccesses) body.maxAccesses = next.maxAccesses;
  if (next.enabled !== target.enabled) body.enabled = next.enabled;
  if (next.clearPassword) body.password = null;
  else if (next.password.trim()) body.password = next.password.trim();

  if (Object.keys(body).length === 0) {
    message.info('没有修改内容');
    editShow.value = false;
    return;
  }

  editSaving.value = true;
  try {
    await updateShare(target.token, body);
    message.success('分享链接已更新');
    editShow.value = false;
    await load(false);
  } catch (e) {
    message.error(getErrorMessage(e, '更新分享链接失败'));
  } finally {
    editSaving.value = false;
  }
}

async function toggleEnabled(link: ShareLink) {
  try {
    await updateShare(link.token, { enabled: !link.enabled });
    message.success(link.enabled ? '分享链接已停用' : '分享链接已启用');
    await load(false);
  } catch (e) {
    message.error(getErrorMessage(e, '切换启停状态失败'));
  }
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
            <NButton size="small" quaternary circle @click="() => load()">
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
      列表由服务端分页与检索（token / 文件 / 分类 / 备注）；停用后访问返回「已停用」，撤销会物理删除链接与访问记录
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
        v-else-if="!loading && links.length === 0"
        :icon="LinkOutline"
        :title="counts.all === 0 ? '还没有分享链接' : '没有符合条件的分享'"
        :description="
          counts.all === 0
            ? '把文件库里的文件生成公开链接，发给同事或外部协作者即可直接访问与下载。'
            : '调整状态筛选或清空搜索关键词后再试。'
        "
      >
        <NButton v-if="counts.all === 0" type="primary" size="small" @click="openCreate">
          创建第一个分享
        </NButton>
        <NButton v-else size="small" @click="keyword = ''; statusFilter = 'all'">
          清空筛选
        </NButton>
      </EmptyState>

      <div v-else class="flex flex-col gap-3">
        <article
          v-for="link in links"
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
              <p v-if="link.remark" class="m-0 mt-0.5 text-11px text-ink-sub truncate">
                备注：{{ link.remark }}
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
            <NButton size="tiny" @click="openEdit(link)">
              <template #icon><NIcon><CreateOutline /></NIcon></template>
              编辑
            </NButton>
            <NButton size="tiny" quaternary @click="toggleEnabled(link)">
              <template #icon>
                <NIcon>
                  <PlayCircleOutline v-if="!link.enabled" />
                  <PauseCircleOutline v-else />
                </NIcon>
              </template>
              {{ link.enabled ? '停用' : '启用' }}
            </NButton>
            <NButton size="tiny" quaternary type="error" class="ml-auto" @click="openRevoke(link)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>
              撤销
            </NButton>
          </div>
        </article>

        <footer class="glass-panel px-4 py-2 flex flex-wrap items-center justify-end gap-2">
          <span class="mr-auto text-11px text-ink-sub">
            共 {{ total }} 条 · 服务端分页
          </span>
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="total"
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

        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">备注（可选，仅后台可见）</span>
          <NInput
            v-model:value="form.remark"
            size="small"
            maxlength="255"
            clearable
            placeholder="例如：发给市场部的新版物料"
          />
        </label>

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
            打开次数按「成功解锁」计数，解锁后下载文件不重复计数。
            暂不支持整目录分享：服务端未提供目录打包下载能力，多文件请在此多选生成文件集合。
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

    <!-- 编辑分享 -->
    <NModal
      v-model:show="editShow"
      preset="card"
      title="编辑分享链接"
      class="w-620px! max-w-[94vw]"
      :bordered="false"
    >
      <div class="flex flex-col gap-4">
        <p class="m-0 text-11px text-ink-sub font-mono break-all">
          {{ editTarget?.token }}
        </p>

        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">备注（仅后台可见）</span>
          <NInput
            v-model:value="editForm.remark"
            size="small"
            maxlength="255"
            clearable
            placeholder="留空则清除备注"
          />
        </label>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">有效期（清空为永久）</span>
            <NDatePicker
              v-model:value="editForm.expiresAt"
              size="small"
              type="datetime"
              clearable
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">最大打开次数（留空不限制）</span>
            <NInputNumber
              v-model:value="editForm.maxAccesses"
              size="small"
              :min="1"
              :max="1000000"
              clearable
              placeholder="不限制"
            />
          </label>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">
              新访问密码{{ editTarget?.hasPassword ? '（留空则保留原密码）' : '（可选）' }}
            </span>
            <NInput
              v-model:value="editForm.password"
              size="small"
              type="password"
              show-password-on="click"
              :disabled="editForm.clearPassword"
              placeholder="输入新密码"
            />
          </label>
          <div class="flex flex-col gap-2 justify-center">
            <div class="flex items-center gap-2">
              <NSwitch v-model:value="editForm.clearPassword" size="small" />
              <span class="text-12px text-ink-sub">清除访问密码</span>
            </div>
            <div class="flex items-center gap-2">
              <NSwitch v-model:value="editForm.enabled" size="small" />
              <span class="text-12px text-ink-sub">启用链接</span>
            </div>
          </div>
        </div>

        <p class="m-0 text-11px text-ink-sub">
          停用后公开访问返回「分享链接已停用」（HTTP 410），不会误报为不存在；重新启用即可恢复。
        </p>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <NButton size="small" @click="editShow = false">取消</NButton>
          <NButton size="small" type="primary" :loading="editSaving" @click="submitEdit">
            保存
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
