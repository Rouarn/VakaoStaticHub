<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  NButton,
  NCheckbox,
  NIcon,
  NInput,
  NPagination,
  NTag,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  LinkOutline,
  PauseCircleOutline,
  PlayCircleOutline,
  SearchOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  ShareBatchAction,
  ShareBatchResult,
  ShareLink,
  ShareLinkStatus,
  ShareListResult,
} from '@vakao/shared';
import { RequestError } from '@vakao/axios';
import {
  batchShareAction,
  getSharePageUrl,
  listShares,
  revokeShare,
  updateShare,
} from '@/api/shares';
import { getErrorMessage } from '@/utils/http';
import { formatDateTime } from '@/utils/format';
import { useOverviewStore } from '@/stores/modules/overview';
import EmptyState from '@/components/common/empty-state.vue';
import PageHeader from '@/components/common/page-header.vue';
import ErrorState from '@/components/common/error-state.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import ListLoading from '@/components/common/list-loading.vue';
import RefreshButton from '@/components/common/refresh-button.vue';
import { useListLoading } from '@/composables/use-list-loading';
import ShareQrModal from './components/share-qr-modal.vue';
import CreateShareModal from './components/create-share-modal.vue';
import EditShareModal from './components/edit-share-modal.vue';
import ShareLogsModal from './components/share-logs-modal.vue';
import ShareBatchResultModal from './components/share-batch-result-modal.vue';

/**
 * 分享链接管理
 *
 * 服务端能力：
 * - GET /share/list 服务端分页 + 关键字 + 状态 counts
 * - PATCH /share/:token 编辑备注 / 有效期 / 密码 / 次数上限 / 启停
 * - DELETE /share/:token 物理删除（含访问记录）
 * - 仅支持单文件与文件集合；整目录分享暂不支持
 */
const overview = useOverviewStore();
const message = useMessage();

const result = ref<ShareListResult | null>(null);
/** 加载态与中文提示：文案规则见 useListLoading */
const {
  loading,
  loadingText,
  refreshing,
  justRefreshed,
  begin: beginLoading,
  refresh,
} = useListLoading();
const error = ref('');
const now = ref(Date.now());

const keyword = ref('');
const statusFilter = ref<'all' | ShareLinkStatus>('all');
const page = ref(1);
const pageSize = ref(8);

const links = computed(() => result.value?.items ?? []);
const total = computed(() => result.value?.total ?? 0);

/** 切换分页/筛选前清空当前页行；counts 与 total 保留，供头部与分页继续显示 */
function clearLinks() {
  if (result.value) result.value = { ...result.value, items: [] };
}
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

// ===================== 批量选择 =====================
/**
 * 选中项只保留当前页：分页存在时「全选」语义是「全选当前页」，
 * 跨页选中会让计数与实际操作范围产生歧义。翻页 / 筛选 / 改每页条数时清空。
 */
const selected = ref<Set<string>>(new Set());
const selectedTotal = computed(() => selected.value.size);
const pageCount = computed(() => links.value.length);
const allSelected = computed(
  () =>
    links.value.length > 0 &&
    links.value.every((link) => selected.value.has(link.token)),
);
const partiallySelected = computed(
  () => selectedTotal.value > 0 && !allSelected.value,
);

function toggleSelect(token: string) {
  const next = new Set(selected.value);
  if (next.has(token)) next.delete(token);
  else next.add(token);
  selected.value = next;
}

function toggleSelectAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(links.value.map((link) => link.token));
}

function clearSelection() {
  selected.value = new Set();
}

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
  {
    key: 'exhausted' as const,
    label: '次数用尽',
    count: counts.value.exhausted,
  },
  { key: 'disabled' as const, label: '已停用', count: counts.value.disabled },
]);

/** 请求序号：分页 / 筛选可能并发触发同一 key 请求，用序号丢弃过期与取消结果 */
let shareSeq = 0;

/**
 * silent=true 用于手动刷新：不显示遮罩、失败时保留当前列表，
 * 错误抛给 useListLoading.refresh 统一提示。
 */
async function load(options: { silent?: boolean } = {}, allowClamp = true) {
  const seq = ++shareSeq;
  if (!options.silent) loading.value = true;
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
    // 只保留当前页仍存在的选中项（翻页 / 数据被外部删除后自动收敛）
    const visibleTokens = new Set(data.items.map((item) => item.token));
    selected.value = new Set(
      [...selected.value].filter((token) => visibleTokens.has(token)),
    );
    const maxPage = Math.max(1, Math.ceil(data.total / pageSize.value));
    if (allowClamp && page.value > maxPage) {
      page.value = maxPage;
      await load(options, false);
    }
  } catch (e) {
    if (seq !== shareSeq) return;
    if (e instanceof RequestError && e.type === 'cancel') return;
    if (options.silent) throw e;
    error.value = getErrorMessage(e, '分享列表加载失败');
    result.value = null;
  } finally {
    if (!options.silent && seq === shareSeq) loading.value = false;
  }
}

/** 顶部刷新按钮：不走遮罩，图标旋转 → 对勾 → 箭头 */
function refreshList() {
  void refresh(() => load({ silent: true }), '刷新失败');
}

/** 进入加载态并清空当前页，再拉取目标页 */
function reloadPage() {
  beginLoading(clearLinks);
  void load();
}

/** 筛选变化后回到第一页并重新拉取（已在第一页时直接请求，避免 page watcher 不触发） */
function resetAndReload() {
  clearSelection();
  if (page.value === 1) reloadPage();
  else page.value = 1;
}

watch(page, () => {
  clearSelection();
  reloadPage();
});
watch(pageSize, resetAndReload);
watch(statusFilter, resetAndReload);
watch(keyword, useDebounceFn(resetAndReload, 300));

function targetLabel(link: ShareLink) {
  if (link.shareType === 'collection') {
    return `文件集合（${link.filePaths.length} 个文件）`;
  }
  const path = link.filePaths[0];
  return path.split('/').pop() ?? path;
}

// ===================== 创建分享 =====================
const createRef = ref<InstanceType<typeof CreateShareModal> | null>(null);

function openCreate() {
  createRef.value?.open();
}

// ===================== 链接操作 =====================
const qrShow = ref(false);
const qrUrl = ref('');

/** 创建成功：打开二维码，刷新列表与侧栏徽标 */
function onShareCreated(link: ShareLink) {
  qrUrl.value = getSharePageUrl(link.token);
  qrShow.value = true;
  void load();
  // 侧栏徽标与列表同源，创建成功后立即同步
  void overview.refresh();
}

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
const logsLink = ref<ShareLink | null>(null);

function openLogs(link: ShareLink) {
  logsLink.value = link;
  logsShow.value = true;
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
    // 撤销是物理删除，总数随之减少
    void overview.refresh();
  } catch (e) {
    message.error(getErrorMessage(e, '撤销失败'));
  } finally {
    revoking.value = false;
  }
}

// ===================== 编辑 / 启停 =====================
const editShow = ref(false);
const editTarget = ref<ShareLink | null>(null);

function openEdit(link: ShareLink) {
  editTarget.value = link;
  editShow.value = true;
}

/** 行内「更多」菜单：二维码 / 访问记录 / 编辑 / 撤销 */
const rowMenuOptions = [
  { label: '二维码', key: 'qr' },
  { label: '访问记录', key: 'logs' },
  { label: '编辑', key: 'edit' },
  { type: 'divider', key: 'd1' },
  { label: '撤销链接', key: 'revoke' },
];

function onRowAction(key: string, link: ShareLink) {
  if (key === 'qr') openQr(link.token);
  else if (key === 'logs') void openLogs(link);
  else if (key === 'edit') openEdit(link);
  else if (key === 'revoke') openRevoke(link);
}

async function toggleEnabled(link: ShareLink) {
  try {
    await updateShare(link.token, { enabled: !link.enabled });
    message.success(link.enabled ? '分享链接已停用' : '分享链接已启用');
    await load({}, false);
  } catch (e) {
    message.error(getErrorMessage(e, '切换启停状态失败'));
  }
}

// ===================== 批量操作 =====================
const ACTION_LABEL: Record<ShareBatchAction, string> = {
  enable: '启用',
  disable: '停用',
  delete: '删除',
};

const batchRunning = ref<ShareBatchAction | null>(null);
const batchResult = ref<ShareBatchResult | null>(null);
const batchResultShow = ref(false);
const batchConfirmShow = ref(false);

const batchFailedItems = computed(
  () => batchResult.value?.results.filter((item) => !item.success) ?? [],
);
/** 失败项中仍留在当前页的数量：这些会保持选中，可直接重试 */
const batchRetryableCount = computed(() => {
  const visible = new Set(links.value.map((link) => link.token));
  return batchFailedItems.value.filter((item) => visible.has(item.token))
    .length;
});

function openBatchDelete() {
  if (selected.value.size === 0 || batchRunning.value) return;
  batchConfirmShow.value = true;
}

async function runBatchAction(action: ShareBatchAction) {
  const tokens = [...selected.value];
  if (tokens.length === 0 || batchRunning.value) return;
  batchRunning.value = action;
  try {
    const result = await batchShareAction(tokens, action);
    batchResult.value = result;
    await load();
    // 仅删除会改变总数；启用 / 停用不影响徽标
    if (action === 'delete') void overview.refresh();
    // 失败项若仍在当前页则保持选中方便重试；已被外部删除的项无法重试
    const visible = new Set(links.value.map((link) => link.token));
    selected.value = new Set(
      result.results
        .filter((item) => !item.success && visible.has(item.token))
        .map((item) => item.token),
    );
    if (result.failed === 0) {
      message.success(
        `已${ACTION_LABEL[action]} ${result.succeeded} 个分享链接`,
      );
    } else {
      message.warning(
        `已${ACTION_LABEL[action]} ${result.succeeded} 个，失败 ${result.failed} 个`,
      );
      batchResultShow.value = true;
    }
  } catch (e) {
    message.error(getErrorMessage(e, '批量操作失败'));
  } finally {
    batchRunning.value = null;
  }
}

async function confirmBatchDelete() {
  batchConfirmShow.value = false;
  await runBatchAction('delete');
}

onMounted(async () => {
  await load();
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4">
    <!-- 页头（对齐原型 topbar） -->
    <PageHeader
      title="分享管理"
      :description="`共 ${total} 条 · 活跃 ${counts.active} · 已停用 ${counts.disabled} · 已失效 ${counts.expired + counts.exhausted}`"
    >
      <template #actions>
        <RefreshButton
          :loading="refreshing"
          :success="justRefreshed"
          @click="refreshList"
        />
        <NButton type="primary" size="small" @click="openCreate">
          <template #icon
            ><NIcon><AddOutline /></NIcon>
          </template>
          创建分享
        </NButton>
      </template>
    </PageHeader>

    <!-- 第 2 块：工具条区（搜索、状态筛选），统一左侧起排 -->
    <section
      class="glass-panel px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0"
    >
      <!-- 外层定宽：NInput 自身 width:100% 会覆盖 UnoCSS 的宽度；窄屏整行占满，宽屏固定 224px -->
      <div class="w-full shrink-0 sm:w-56">
        <NInput
          v-model:value="keyword"
          size="small"
          clearable
          placeholder="搜索 token / 文件 / 分类"
        >
          <template #prefix
            ><NIcon :size="15"><SearchOutline /></NIcon
          ></template>
        </NInput>
      </div>

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
    </section>

    <!-- 批量操作条：有选中项时出现，仅作用于当前页选中项 -->
    <div
      v-if="selectedTotal > 0"
      class="glass-panel px-4 py-2 flex flex-wrap items-center gap-2"
    >
      <span class="text-12px text-ink">
        已选
        <span class="font-600 tabular-nums">{{ selectedTotal }}</span>
        项
      </span>
      <span class="text-11px text-ink-sub">
        / 本页 {{ pageCount }} 项（仅作用于当前页）
      </span>
      <div class="ml-auto flex items-center gap-1.5 flex-wrap">
        <NButton
          size="tiny"
          :disabled="batchRunning !== null"
          :loading="batchRunning === 'disable'"
          @click="runBatchAction('disable')"
        >
          <template #icon
            ><NIcon><PauseCircleOutline /></NIcon
          ></template>
          批量停用
        </NButton>
        <NButton
          size="tiny"
          :disabled="batchRunning !== null"
          :loading="batchRunning === 'enable'"
          @click="runBatchAction('enable')"
        >
          <template #icon
            ><NIcon><PlayCircleOutline /></NIcon
          ></template>
          批量启用
        </NButton>
        <NButton
          size="tiny"
          type="error"
          secondary
          :disabled="batchRunning !== null"
          :loading="batchRunning === 'delete'"
          @click="openBatchDelete"
        >
          <template #icon
            ><NIcon><TrashOutline /></NIcon
          ></template>
          批量删除
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :disabled="batchRunning !== null"
          @click="clearSelection"
        >
          取消选择
        </NButton>
      </div>
    </div>

    <!-- 第 3 块：内容区（列表独立滚动 + 底部固定分页） -->
    <div class="flex-1 min-h-0 flex flex-col gap-3">
      <div class="relative flex-1 min-h-0">
        <div class="h-full overflow-y-auto pr-1">
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
            <NButton
              v-if="counts.all === 0"
              type="primary"
              size="small"
              @click="openCreate"
            >
              创建第一个分享
            </NButton>
            <NButton
              v-else
              size="small"
              @click="
                keyword = '';
                statusFilter = 'all';
              "
            >
              清空筛选
            </NButton>
          </EmptyState>

          <div v-else class="glass-panel overflow-hidden">
            <div class="overflow-x-auto">
              <table class="app-table min-w-880px">
                <thead>
                  <tr>
                    <th class="w-9 pl-4">
                      <NCheckbox
                        :checked="allSelected"
                        :indeterminate="partiallySelected"
                        :disabled="links.length === 0"
                        aria-label="全选当前页"
                        @update:checked="toggleSelectAll"
                      />
                    </th>
                    <th>分享链接</th>
                    <th>目标文件</th>
                    <th>状态</th>
                    <th class="num">访问次数</th>
                    <th class="num">过期时间</th>
                    <th class="text-right pr-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="link in links"
                    :key="link.token"
                    :class="{ 'bg-brand-500/6': selected.has(link.token) }"
                  >
                    <td class="pl-4">
                      <NCheckbox
                        :checked="selected.has(link.token)"
                        :aria-label="`选择 ${targetLabel(link)}`"
                        @update:checked="toggleSelect(link.token)"
                      />
                    </td>
                    <td>
                      <div class="flex items-center gap-2 min-w-0">
                        <span
                          class="font-mono text-11.5px text-ink truncate"
                          :title="link.token"
                        >
                          {{ link.token.slice(0, 8) }}…{{
                            link.token.slice(-6)
                          }}
                        </span>
                        <NTag
                          v-if="link.hasPassword"
                          size="tiny"
                          :bordered="false"
                        >
                          密码
                        </NTag>
                      </div>
                      <div
                        v-if="link.remark"
                        class="mt-0.5 text-11px text-ink-sub truncate max-w-220px"
                        :title="link.remark"
                      >
                        {{ link.remark }}
                      </div>
                    </td>
                    <td>
                      <div
                        class="text-ink truncate max-w-260px"
                        :title="targetLabel(link)"
                      >
                        {{ targetLabel(link) }}
                      </div>
                      <div class="mt-0.5 text-11px text-ink-sub truncate">
                        {{ link.category }}
                      </div>
                    </td>
                    <td>
                      <NTag
                        size="small"
                        :type="STATUS_TAG[statusOf(link)].type"
                        :bordered="false"
                      >
                        {{ STATUS_TAG[statusOf(link)].label }}
                      </NTag>
                    </td>
                    <td class="num">
                      {{ link.accessCount }}
                      <span
                        v-if="link.maxAccesses !== null"
                        class="text-ink-sub"
                      >
                        / {{ link.maxAccesses }}</span
                      >
                    </td>
                    <td class="num">
                      {{
                        link.expiresAt ? formatDateTime(link.expiresAt) : '永久'
                      }}
                    </td>
                    <td class="pr-4">
                      <div class="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          class="border-none bg-transparent p-0 text-12px text-ink-sub cursor-pointer transition-colors hover:text-brand-600 dark:hover:text-brand-400"
                          @click="copyUrl(link.token)"
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          class="border-none bg-transparent p-0 text-12px text-ink-sub cursor-pointer transition-colors hover:text-brand-600 dark:hover:text-brand-400"
                          @click="toggleEnabled(link)"
                        >
                          {{ link.enabled ? '停用' : '启用' }}
                        </button>
                        <NDropdown
                          trigger="click"
                          :options="rowMenuOptions"
                          placement="bottom-end"
                          @select="(key: string) => onRowAction(key, link)"
                        >
                          <button
                            type="button"
                            class="border-none bg-transparent p-0 text-12px text-ink-sub cursor-pointer hover:text-ink"
                            aria-label="更多操作"
                          >
                            ⋯
                          </button>
                        </NDropdown>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <ListLoading :show="loading" :text="loadingText" />
      </div>

      <footer
        v-if="total > 0"
        class="flex flex-wrap items-center justify-end gap-2 shrink-0 px-1 pb-1"
      >
        <span class="mr-auto text-11px text-ink-sub tabular-nums">
          共 {{ total }} 条 · 第 {{ page }} /
          {{ Math.max(1, Math.ceil(total / pageSize)) }} 页
        </span>
        <NPagination
          :page-slot="5"
          v-model:page="page"
          v-model:page-size="pageSize"
          :item-count="total"
          :page-sizes="[8, 16, 32, 64]"
          :disabled="loading"
          show-size-picker
        />
      </footer>
    </div>

    <!-- 创建分享 -->
    <CreateShareModal ref="createRef" @created="onShareCreated" />

    <!-- 编辑分享 -->
    <EditShareModal
      v-model:show="editShow"
      :link="editTarget"
      @saved="() => load({}, false)"
    />

    <!-- 二维码 -->
    <ShareQrModal
      v-model:show="qrShow"
      :url="qrUrl"
      :filename="`share-${qrUrl.split('/').pop() ?? 'qr'}.png`"
    />

    <!-- 访问记录 -->
    <ShareLogsModal v-model:show="logsShow" :link="logsLink" />

    <ConfirmModal
      v-model:show="batchConfirmShow"
      :title="`批量删除 ${selectedTotal} 个分享链接`"
      :content="`将物理删除当前页选中的 ${selectedTotal} 个分享链接及其全部访问记录，删除后不可恢复，已发出的链接会立即失效。\n范围：已选 ${selectedTotal} 项 / 本页 ${pageCount} 项。`"
      :positive-text="`删除 ${selectedTotal} 项`"
      :loading="batchRunning === 'delete'"
      @confirm="confirmBatchDelete"
    />

    <!-- 批量操作结果：部分失败时如实展示成功/失败条数与原因 -->
    <ShareBatchResultModal
      v-model:show="batchResultShow"
      :result="batchResult"
      :retryable-count="batchRetryableCount"
      :action-label="batchResult ? ACTION_LABEL[batchResult.action] : ''"
    />

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
