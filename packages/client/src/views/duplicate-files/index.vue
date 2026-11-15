<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { NButton, NIcon, NPagination, NSelect, useMessage } from 'naive-ui';
import {
  CopyOutline,
  InformationCircleOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { DuplicateGroup, DuplicateScanResult } from '@vakao/shared';
import { batchDelete, getDuplicateFiles } from '@/api/files';
import { listRoots } from '@/api/roots';
import { getErrorMessage } from '@/utils/http';
import { isImage } from '@/utils/file-types';
import { buildFileUrl, buildThumbUrl } from '@/utils/file-url';
import { fileVersion } from '@/utils/preview-source';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import ListLoading from '@/components/common/list-loading.vue';
import RefreshButton from '@/components/common/refresh-button.vue';
import { useListLoading } from '@/composables/use-list-loading';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';
import DuplicateGroupCard from './components/duplicate-group-card.vue';
import CleanupConfirmModal from './components/cleanup-confirm-modal.vue';
import type { CleanupPlan } from './components/types';

/**
 * 重复文件检测与清理
 *
 * 后端 /files/duplicates 支持服务端分页（page/pageSize）。
 * 清理按组执行：每组必须保留 1 个文件，其余永久删除（二次确认里写明保留项）。
 */
const message = useMessage();

const roots = ref<{ id: string; name: string }[]>([]);
const rootId = ref('');
const scan = ref<DuplicateScanResult | null>(null);
const error = ref('');

const page = ref(1);
const pageSize = ref(5);
/** 加载态与中文提示：文案规则见 useListLoading（翻页时带页码） */
const {
  loading,
  loadingText,
  refreshing,
  justRefreshed,
  begin: beginLoading,
  refresh,
} = useListLoading({ page });
const expanded = ref<Set<string>>(new Set());
const keepIndex = ref<Record<string, number>>({});
const previewShow = ref(false);
const previewIndex = ref(0);
const previewFiles = ref<PreviewTarget[]>([]);

const rootOptions = computed(() => [
  { label: '全部根目录', value: '' },
  ...roots.value.map((root) => ({ label: root.name, value: root.id })),
]);

const groups = computed(() => scan.value?.groups ?? []);
const groupCount = computed(() => scan.value?.groupCount ?? 0);

function rootName(id: string) {
  return roots.value.find((root) => root.id === id)?.name ?? id;
}

/** 重复组内任意一张缩略图 → 打开整组预览，左右切换对比 */
function openPreview(group: DuplicateGroup, index: number) {
  previewFiles.value = group.files.map((file) => ({
    filename: file.name,
    src: isImage(file.name)
      ? buildThumbUrl({ code: file.code }, 'preview')
      : buildFileUrl({ code: file.code }),
    downloadSrc: buildFileUrl({
      code: file.code,
      download: true,
    }),
    size: file.size,
    version: fileVersion(file.size, file.mtime),
  }));
  previewIndex.value = index;
  previewShow.value = true;
}

async function loadRoots() {
  try {
    roots.value = await listRoots();
  } catch {
    roots.value = [];
  }
}

/**
 * 加载当前页；页码超出末页时回退到末页（清理后总组数可能变少）
 * silent=true 用于手动重新扫描：不显示遮罩、失败时保留当前分组，错误抛给 refresh 统一提示。
 */
async function load(allowClamp = true, options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  error.value = '';
  try {
    const result = await getDuplicateFiles({
      ...(rootId.value ? { rootId: rootId.value } : {}),
      page: page.value,
      pageSize: pageSize.value,
    });
    scan.value = result;
    expanded.value = new Set();
    keepIndex.value = {};

    const maxPage = Math.max(1, Math.ceil(result.groupCount / pageSize.value));
    if (allowClamp && page.value > maxPage) {
      page.value = maxPage;
      await load(false, options);
    }
  } catch (e) {
    if (options.silent) throw e;
    error.value = getErrorMessage(e, '重复文件扫描失败');
    scan.value = null;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

/** 页头「重新扫描」：不走遮罩，图标旋转 → 对勾 → 箭头 */
function rescan() {
  void refresh(() => load(true, { silent: true }), '重新扫描失败');
}

/** 切换根目录 / 每页条数 / 页码前清空分组；统计数字保留到新数据返回，避免分页总数跳动 */
function clearGroups() {
  if (scan.value) scan.value = { ...scan.value, groups: [] };
}

/** 进入加载态并清空旧分组，再请求目标页 */
function reloadPage() {
  beginLoading(clearGroups);
  void load();
}

/** 切换根目录：回到第一页后重新扫描 */
function changeFilter() {
  if (page.value === 1) reloadPage();
  else page.value = 1;
}

function onPageSizeChange() {
  // 页码从非 1 变成 1 时由 page 的 watch 触发加载，避免同一参数重复请求
  if (page.value === 1) reloadPage();
  else page.value = 1;
}

watch(page, reloadPage);

function toggleExpand(hash: string) {
  const next = new Set(expanded.value);
  if (next.has(hash)) next.delete(hash);
  else next.add(hash);
  expanded.value = next;
}

function keepOf(group: DuplicateGroup) {
  return keepIndex.value[group.contentHash] ?? 0;
}

function setKeep(group: DuplicateGroup, index: number) {
  keepIndex.value = { ...keepIndex.value, [group.contentHash]: index };
}

// ===================== 清理 =====================
const cleanupShow = ref(false);
const cleaning = ref(false);
const cleanupScope = ref<'one' | 'all'>('one');
const cleanupGroup = ref<DuplicateGroup | null>(null);

function openCleanup(group: DuplicateGroup) {
  cleanupScope.value = 'one';
  cleanupGroup.value = group;
  cleanupShow.value = true;
}

function openCleanupAll() {
  // 服务端分页后 groups 仅代表当前页，按钮文案为「批量清理本页」
  if (groups.value.length === 0) return;
  cleanupScope.value = 'all';
  cleanupGroup.value = null;
  cleanupShow.value = true;
}

const cleanupPlans = computed<CleanupPlan[]>(() => {
  const selected =
    cleanupScope.value === 'one' && cleanupGroup.value
      ? [cleanupGroup.value]
      : groups.value;
  return selected.map((group) => {
    const index = keepOf(group);
    const keep = group.files[index] ?? group.files[0];
    return {
      group,
      keep: {
        rootId: keep.rootId,
        category: keep.category,
        relPath: keep.relPath,
        name: keep.name,
      },
      remove: group.files
        .filter((_, i) => i !== index)
        .map((file) => ({
          rootId: file.rootId,
          category: file.category,
          relPath: file.relPath,
        })),
    };
  });
});

const totalRemoving = computed(() =>
  cleanupPlans.value.reduce((total, plan) => total + plan.remove.length, 0),
);

async function confirmCleanup() {
  cleaning.value = true;
  const failures: string[] = [];
  let deleted = 0;
  try {
    // 同一个 rootId + category 的路径聚合成一次批量删除
    const operations = new Map<
      string,
      { rootId: string; category: string; paths: string[] }
    >();
    for (const plan of cleanupPlans.value) {
      for (const item of plan.remove) {
        const key = `${item.rootId}\u0000${item.category}`;
        const entry = operations.get(key) ?? {
          rootId: item.rootId,
          category: item.category,
          paths: [],
        };
        entry.paths.push(item.relPath);
        operations.set(key, entry);
      }
    }

    for (const operation of operations.values()) {
      try {
        const result = await batchDelete(
          operation.rootId,
          operation.category,
          operation.paths,
        );
        deleted += result.deletedCount;
      } catch (e) {
        failures.push(
          `${rootName(operation.rootId)} / ${operation.category}：${getErrorMessage(e, '批量删除失败')}`,
        );
      }
    }

    if (failures.length > 0) {
      message.warning(
        `已删除 ${deleted} 个，${failures.length} 组失败：${failures[0]}`,
      );
    } else {
      message.success(`已清理 ${deleted} 个重复文件`);
    }
    cleanupShow.value = false;
    await load();
  } finally {
    cleaning.value = false;
  }
}

onMounted(async () => {
  await loadRoots();
  await load();
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4">
    <PageHeader
      title="重复文件"
      description="按内容 SHA-256 检测重复文件，可逐组对比并保留一个后清理其余"
      :icon="CopyOutline"
    >
      <template #actions>
        <NSelect
          v-model:value="rootId"
          size="small"
          class="w-36!"
          :options="rootOptions"
          @update:value="changeFilter"
        />
        <RefreshButton
          text="重新扫描"
          :loading="refreshing"
          :success="justRefreshed"
          @click="rescan"
        />
        <NButton
          size="small"
          type="primary"
          :disabled="groups.length === 0"
          @click="openCleanupAll"
        >
          <template #icon
            ><NIcon><TrashOutline /></NIcon
          ></template>
          批量清理本页
        </NButton>
      </template>
    </PageHeader>

    <div
      class="glass-chip shrink-0 self-start px-3 py-1.5 flex items-center gap-1.5 text-11px text-ink-sub"
    >
      <NIcon :size="14"><InformationCircleOutline /></NIcon>
      后端 /files/duplicates 服务端分页（page /
      pageSize），按内容哈希分组；扫描会惰性补算缺失的内容哈希
    </div>

    <div class="relative flex-1 min-h-0">
      <div class="h-full overflow-y-auto pr-1">
        <ErrorState v-if="error" :message="error" @retry="() => load()" />

        <EmptyState
          v-else-if="!loading && groups.length === 0"
          :icon="CopyOutline"
          title="没有检测到重复文件"
          :description="
            scan
              ? `已扫描 ${scan.hashedCount} 个文件，未发现内容哈希相同的重复组，存储空间很干净。`
              : '选择根目录后点击「重新扫描」开始检测。'
          "
        >
          <RefreshButton
            text="重新扫描"
            :quaternary="false"
            :loading="refreshing"
            :success="justRefreshed"
            @click="rescan"
          />
        </EmptyState>

        <div v-else class="flex flex-col gap-4">
          <div class="grid gap-3 grid-cols-3">
            <div class="glass-card px-4 py-3">
              <p class="m-0 text-11px text-ink-sub">重复组</p>
              <p class="m-0 mt-1 text-18px font-600 text-ink">
                {{ scan?.groupCount ?? 0 }}
              </p>
            </div>
            <div class="glass-card px-4 py-3">
              <p class="m-0 text-11px text-ink-sub">重复文件总数</p>
              <p class="m-0 mt-1 text-18px font-600 text-ink">
                {{ scan?.duplicateFileCount ?? 0 }}
              </p>
            </div>
            <div class="glass-card px-4 py-3">
              <p class="m-0 text-11px text-ink-sub">本次补算哈希</p>
              <p class="m-0 mt-1 text-18px font-600 text-ink">
                {{ scan?.hashedCount ?? 0 }}
              </p>
            </div>
          </div>

          <DuplicateGroupCard
            v-for="group in groups"
            :key="group.contentHash"
            :group="group"
            :expanded="expanded.has(group.contentHash)"
            :keep-index="keepOf(group)"
            :root-name="rootName"
            @toggle="toggleExpand"
            @set-keep="setKeep"
            @cleanup="openCleanup"
            @preview="openPreview"
          />

          <footer
            class="glass-panel sticky bottom-0 z-10 px-4 py-2 flex flex-wrap items-center justify-end gap-2"
          >
            <span class="mr-auto text-11px text-ink-sub">
              共 {{ groupCount }} 组 · 服务端分页
            </span>
            <NPagination
              :page-slot="5"
              v-model:page="page"
              v-model:page-size="pageSize"
              :item-count="groupCount"
              :page-sizes="[5, 10, 20]"
              show-size-picker
              @update:page-size="onPageSizeChange"
            />
          </footer>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>

    <!-- 清理确认 -->
    <CleanupConfirmModal
      v-model:show="cleanupShow"
      :plans="cleanupPlans"
      :total-removing="totalRemoving"
      :loading="cleaning"
      :root-name="rootName"
      @confirm="confirmCleanup"
    />

    <PreviewDialog
      v-model:show="previewShow"
      v-model:index="previewIndex"
      :files="previewFiles"
    />
  </div>
</template>
