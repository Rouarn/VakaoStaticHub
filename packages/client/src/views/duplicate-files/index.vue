<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { NButton, NIcon, NPagination, NSelect, useMessage } from 'naive-ui';
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CopyOutline,
  FolderOpenOutline,
  InformationCircleOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  DuplicateFileItem,
  DuplicateGroup,
  DuplicateScanResult,
} from '@vakao/shared';
import { batchDelete, getDuplicateFiles } from '@/api/files';
import { listRoots } from '@/api/roots';
import { getErrorMessage } from '@/utils/http';
import {
  formatBytes,
  formatTime,
  getExtension,
  getFileKind,
  isImage,
} from '@/utils/file-types';
import { buildFileUrl, buildThumbUrl } from '@/utils/file-url';
import { truncateMiddle } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import ListLoading from '@/components/common/list-loading.vue';
import RefreshButton from '@/components/common/refresh-button.vue';
import { useListLoading } from '@/composables/use-list-loading';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';

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

function isImageFile(file: DuplicateFileItem) {
  return getFileKind(file.name) === 'image';
}

function extOf(file: DuplicateFileItem) {
  return (getExtension(file.name) || 'FILE').toUpperCase();
}

function thumbOf(file: DuplicateFileItem) {
  return buildThumbUrl({ code: file.code }, 'thumbnail');
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

interface CleanupPlan {
  group: DuplicateGroup;
  keep: { rootId: string; category: string; relPath: string; name: string };
  remove: { rootId: string; category: string; relPath: string }[];
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

          <section
            v-for="group in groups"
            :key="group.contentHash"
            class="glass-panel px-4 py-3 flex flex-col gap-3"
          >
            <div class="flex items-center gap-3 flex-wrap">
              <div
                class="glass-chip w-9 h-9 flex items-center justify-center shrink-0"
              >
                <NIcon :size="18" class="text-brand-600 dark:text-brand-400"
                  ><CopyOutline
                /></NIcon>
              </div>
              <div class="min-w-0 flex-1">
                <p
                  class="m-0 text-13px text-ink font-600 truncate"
                  :title="group.files[keepOf(group)]?.name"
                >
                  {{ group.files[keepOf(group)]?.name ?? '重复文件组' }}
                </p>
                <p class="m-0 mt-0.5 text-11px text-ink-sub">
                  单文件 {{ formatBytes(group.size) }} ·
                  {{ group.count }} 个副本 · 可释放
                  {{ formatBytes(group.size * (group.count - 1)) }} ·
                  <span class="font-mono" :title="group.contentHash">{{
                    truncateMiddle(group.contentHash, 14, 10)
                  }}</span>
                </p>
              </div>
              <div class="flex items-center gap-1.5">
                <NButton size="tiny" @click="toggleExpand(group.contentHash)">
                  <template #icon>
                    <NIcon>
                      <ChevronDownOutline
                        v-if="expanded.has(group.contentHash)"
                      />
                      <ChevronForwardOutline v-else />
                    </NIcon>
                  </template>
                  {{
                    expanded.has(group.contentHash) ? '收起对比' : '展开对比'
                  }}
                </NButton>
                <NButton
                  size="tiny"
                  type="error"
                  quaternary
                  @click="openCleanup(group)"
                >
                  <template #icon
                    ><NIcon><TrashOutline /></NIcon
                  ></template>
                  清理本组
                </NButton>
              </div>
            </div>

            <!-- 默认展示摘要，展开后对比 -->
            <div
              v-if="!expanded.has(group.contentHash)"
              class="flex flex-wrap items-start gap-2"
            >
              <button
                v-for="(file, index) in group.files"
                :key="`${file.rootId}-${file.category}-${file.relPath}`"
                type="button"
                class="group relative w-14 text-left bg-transparent border-none p-0 cursor-pointer"
                :title="`${file.name}\n${rootName(file.rootId)} / ${file.category}`"
                @click="openPreview(group, index)"
              >
                <span
                  class="block w-14 h-14 rounded-lg overflow-hidden border border-[var(--mat-line)] bg-[var(--mat-chip)]"
                  :class="
                    index === keepOf(group) ? 'ring-2 ring-brand-500/70' : ''
                  "
                >
                  <img
                    v-if="isImageFile(file)"
                    :src="thumbOf(file)"
                    :alt="file.name"
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                  <span
                    v-else
                    class="w-full h-full flex items-center justify-center text-10px font-600 text-ink-sub"
                  >
                    {{ extOf(file) }}
                  </span>
                </span>
                <span
                  v-if="index === keepOf(group)"
                  class="absolute left-1 top-1 rounded bg-brand-600 px-1 text-9px text-white leading-4"
                  >保留</span
                >
                <span
                  class="mt-1 block text-10px text-ink-sub truncate max-w-14"
                  >{{ file.name }}</span
                >
              </button>
            </div>

            <div v-else class="overflow-x-auto">
              <table
                class="app-table w-full min-w-720px border-collapse text-12px"
              >
                <thead>
                  <tr class="text-left text-11px text-ink-sub">
                    <th class="py-2 pr-3 font-500">保留</th>
                    <th class="py-2 px-2 font-500">文件</th>
                    <th class="py-2 px-2 font-500">根目录 / 分类</th>
                    <th class="py-2 px-2 font-500 text-right">大小</th>
                    <th class="py-2 pl-2 font-500 text-right">修改时间</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(file, index) in group.files"
                    :key="`${file.rootId}-${file.category}-${file.relPath}`"
                    class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
                    :class="index === keepOf(group) ? 'bg-brand-500/8' : ''"
                  >
                    <td class="py-2 pr-3">
                      <NButton
                        size="tiny"
                        :type="index === keepOf(group) ? 'primary' : 'default'"
                        :quaternary="index !== keepOf(group)"
                        @click="setKeep(group, index)"
                      >
                        {{ index === keepOf(group) ? '保留此件' : '改为保留' }}
                      </NButton>
                    </td>
                    <td class="py-2 px-2 min-w-0">
                      <div class="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          class="w-10 h-10 rounded-md overflow-hidden border border-[var(--mat-line)] bg-[var(--mat-chip)] shrink-0 p-0 cursor-pointer"
                          :title="`预览 ${file.name}`"
                          @click="openPreview(group, index)"
                        >
                          <img
                            v-if="isImageFile(file)"
                            :src="thumbOf(file)"
                            :alt="file.name"
                            loading="lazy"
                            decoding="async"
                            class="w-full h-full object-cover"
                          />
                          <span
                            v-else
                            class="w-full h-full flex items-center justify-center text-9px font-600 text-ink-sub"
                            >{{ extOf(file) }}</span
                          >
                        </button>
                        <div class="min-w-0">
                          <p
                            class="m-0 text-ink truncate max-w-260px"
                            :title="file.relPath"
                          >
                            {{ file.name }}
                          </p>
                          <p
                            class="m-0 text-10px text-ink-sub truncate max-w-260px"
                          >
                            {{ file.relPath }}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td class="py-2 px-2 text-ink-sub">
                      {{ rootName(file.rootId) }} / {{ file.category }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ formatBytes(file.size) }}
                    </td>
                    <td class="py-2 pl-2 text-right text-ink-sub">
                      {{ formatTime(file.mtime) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

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
    <ConfirmModal
      v-model:show="cleanupShow"
      title="清理重复文件"
      :content="`将永久删除 ${cleanupPlans.length} 组中的 ${totalRemoving} 个文件，每组保留 1 个（见下方清单）。删除后不可恢复。`"
      positive-text="确认永久删除"
      :loading="cleaning"
      @confirm="confirmCleanup"
    >
      <div class="mt-2 max-h-56 overflow-y-auto flex flex-col gap-1.5">
        <div
          v-for="plan in cleanupPlans"
          :key="plan.group.contentHash"
          class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2 text-11px"
        >
          <p class="m-0 text-ink-sub flex items-center gap-1">
            <NIcon :size="12"><FolderOpenOutline /></NIcon>
            保留：{{ rootName(plan.keep.rootId) }} / {{ plan.keep.category }}
          </p>
          <p class="m-0 text-ink font-600 truncate" :title="plan.keep.relPath">
            {{ plan.keep.name }}
          </p>
          <p class="m-0 text-ink-sub">
            删除其余 {{ plan.remove.length }} 个副本 · 可释放
            {{ formatBytes(plan.group.size * plan.remove.length) }}
          </p>
        </div>
      </div>
    </ConfirmModal>

    <PreviewDialog
      v-model:show="previewShow"
      v-model:index="previewIndex"
      :files="previewFiles"
    />
  </div>
</template>
