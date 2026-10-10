<script setup lang="ts">
import { computed, h, ref } from 'vue';
import {
  useBreakpoints,
  breakpointsTailwind,
  useElementSize,
  useVirtualList,
  useWindowSize,
} from '@vueuse/core';
import {
  NIcon,
  NDataTable,
  NPagination,
  NImageGroup,
  NButton,
  NModal,
  NSelect,
  useMessage,
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import FileCard from './file-card.vue';
import {
  AppsOutline,
  ReorderThreeOutline,
  RefreshOutline,
  FolderOpenOutline,
  DocumentOutline,
  DownloadOutline,
  TrashOutline,
  SearchOutline,
  CreateOutline,
  ArrowUpOutline,
  ArrowDownOutline,
  MoveOutline,
  LinkOutline,
} from '@vicons/ionicons5';
import RenameCategoryModal from './components/rename-category-modal.vue';
import CreateShareModal from './components/create-share-modal.vue';
import { useFileListStore } from '@/stores/modules/file-list/index.ts';
import { batchDeleteFiles, batchMoveFiles } from '@/api/files';
import { getErrorMessage } from '@/utils/request';
import type { SortField } from '@vakao/shared';
import { formatSize, formatDate } from '@/utils/format';
import { buildFileUrl } from '@/utils/url';

defineOptions({
  name: 'file-list',
});

const store = useFileListStore();

const breakpoints = useBreakpoints(breakpointsTailwind);
const isMobile = breakpoints.smaller('md');

const mainContainer = ref<HTMLElement | null>(null);
const { width: containerWidth } = useElementSize(mainContainer);
const { width: windowWidth } = useWindowSize();

const gridCols = computed(() => {
  let width = containerWidth.value;
  const winWidth = windowWidth.value;

  if (width <= 0) {
    if (winWidth > 0) {
      width = winWidth - (isMobile.value ? 32 : 280);
    } else {
      return 2;
    }
  }

  const padding = isMobile.value ? 32 : 64;
  const contentWidth = width - padding;

  if (contentWidth <= 0) return 2;

  const gap = 20;
  const minWidth = 160;
  const cols = Math.floor((contentWidth + gap) / (minWidth + gap));

  return Math.max(2, cols);
});

const chunkedFiles = computed(() => {
  const cols = gridCols.value;
  const result = [];
  for (let i = 0; i < store.files.length; i += cols) {
    result.push({
      id: i,
      items: store.files.slice(i, i + cols),
    });
  }
  return result;
});

const {
  list: virtualRows,
  containerProps,
  wrapperProps,
} = useVirtualList(chunkedFiles, {
  itemHeight: 200,
  overscan: 2,
});

const sortOptions = [
  { label: '时间', value: 'mtime' },
  { label: '名称', value: 'name' },
  { label: '大小', value: 'size' },
];

function handleSortOrderToggle() {
  store.sortOrder = store.sortOrder === 'asc' ? 'desc' : 'asc';
  store.handleSearch();
}

function handleSortByChange(value: SortField) {
  store.sortBy = value;
  store.handleSearch();
}

function handleSearchInput(value: string) {
  store.searchQuery = value;
  if (!value) {
    store.handleSearch();
  }
}

function fileUrl(path: string) {
  return buildFileUrl(store.currentRootId, store.currentCategory, path);
}

function handleDownload(path: string) {
  let url = fileUrl(path);
  if (url.includes('?')) {
    url += '&download=1';
  } else {
    url += '?download=1';
  }

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', '');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

type FileRow = { path: string; size: number; mtime: string | number };

const checkedRowKeys = ref<string[]>([]);

const columns = computed<DataTableColumns<FileRow>>(() => [
  {
    type: 'selection',
  },
  {
    title: '文件名',
    key: 'path',
    width: 300,
    render(row) {
      return h('div', { class: 'flex items-center gap-3' }, [
        h(
          NIcon,
          { class: 'text-xl text-[#6c757d]' },
          {
            default: () => h(DocumentOutline),
          },
        ),
        h(
          'a',
          {
            href: fileUrl(row.path),
            target: '_blank',
            title: row.path,
            class: 'text-sm font-medium text-base hover:text-primary truncate',
          },
          row.path,
        ),
      ]);
    },
  },
  {
    title: '大小',
    key: 'size',
    width: 120,
    render(row) {
      return formatSize(row.size);
    },
  },
  {
    title: '修改时间',
    key: 'mtime',
    width: 200,
    render(row) {
      return formatDate(row.mtime);
    },
  },
  {
    title: '操作',
    key: 'actions',
    align: 'center',
    width: 160,
    render(row) {
      return h('div', { class: 'flex items-center justify-center gap-2' }, [
        h(
          'button',
          {
            type: 'button',
            class:
              'w-8 h-8 inline-flex items-center justify-center rounded-md border border-transparent bg-transparent text-[#6c757d] hover:bg-container hover:text-primary',
            title: '下载',
            onClick: () => handleDownload(row.path),
          },
          [
            h(NIcon, null, {
              default: () => h(DownloadOutline),
            }),
          ],
        ),
        h(
          'button',
          {
            class:
              'w-8 h-8 inline-flex items-center justify-center rounded-md border border-transparent bg-transparent text-[#6c757d] hover:bg-container hover:text-red-500',
            type: 'button',
            title: '删除',
            onClick: () => openDeleteModal(row.path),
          },
          [
            h(NIcon, null, {
              default: () => h(TrashOutline),
            }),
          ],
        ),
      ]);
    },
  },
]);

const showDeleteModal = ref(false);
const deleteTargetPath = ref('');

function openDeleteModal(path: string) {
  deleteTargetPath.value = path;
  showDeleteModal.value = true;
}

const showRenameCategoryModal = ref(false);

function openRenameCategoryModal() {
  showRenameCategoryModal.value = true;
}

// software-update 根下的分类即应用，改名入口在 APP 版本管理；
// 系统默认兜底分类（DEFAULT_CATEGORY）不允许改名
const canRenameCategory = computed(
  () =>
    store.currentRootId !== 'software-update' &&
    store.currentCategory !== store.defaultCategory,
);

const message = useMessage();

async function confirmDelete() {
  if (!deleteTargetPath.value) return;
  const ok = await store.handleDeleteFile(deleteTargetPath.value);
  if (ok) {
    message.success('删除成功');
    showDeleteModal.value = false;
  } else {
    message.error('删除失败');
  }
}

// ==================== 批量操作 ====================

const showBatchDeleteModal = ref(false);
const showBatchMoveModal = ref(false);
const showBatchShareModal = ref(false);
const batchMoveTarget = ref<string | null>(null);
const batchLoading = ref(false);

// software-update 根下分类即应用，移动文件会破坏版本记录（与后端校验一致）
const canBatchMove = computed(() => store.currentRootId !== 'software-update');

const batchMoveOptions = computed(() =>
  store.categories
    .filter((cat) => cat !== store.currentCategory)
    .map((cat) => ({ label: cat, value: cat })),
);

function clearSelection() {
  checkedRowKeys.value = [];
}

async function confirmBatchDelete() {
  if (checkedRowKeys.value.length === 0) return;
  batchLoading.value = true;
  try {
    const result = await batchDeleteFiles(
      store.currentRootId,
      store.currentCategory,
      checkedRowKeys.value,
    );
    message.success(`已删除 ${result.deletedCount} 个文件`);
    showBatchDeleteModal.value = false;
    clearSelection();
    await store.loadFiles();
  } catch {
    message.error('批量删除失败');
  } finally {
    batchLoading.value = false;
  }
}

async function confirmBatchMove() {
  if (!batchMoveTarget.value || checkedRowKeys.value.length === 0) return;
  batchLoading.value = true;
  try {
    const result = await batchMoveFiles(
      store.currentRootId,
      store.currentCategory,
      checkedRowKeys.value,
      batchMoveTarget.value,
    );
    const failed = result.results.filter((r) => !r.success);
    if (failed.length > 0) {
      message.warning(
        `已移动 ${result.movedCount} 个，${failed.length} 个失败（${failed[0].error ?? '未知错误'}）`,
      );
    } else {
      message.success(`已移动 ${result.movedCount} 个文件`);
    }
    showBatchMoveModal.value = false;
    batchMoveTarget.value = null;
    clearSelection();
    await store.loadFiles();
  } catch (e) {
    message.error(getErrorMessage(e, '批量移动失败'));
  } finally {
    batchLoading.value = false;
  }
}
</script>

<template>
  <main
    id="fileManagerMain"
    ref="mainContainer"
    class="px-4 md:px-6 pb-4 relative"
  >
    <div
      class="flex flex-col md:flex-row items-start md:items-center justify-between py-4 mb-4 sticky top-0 z-2 bg-container/95 backdrop-blur supports-[backdrop-filter]:bg-container/80 border-b border-base shadow-sm -mx-4 md:-mx-6 px-4 md:px-6 gap-4 md:gap-0"
    >
      <div>
        <div class="flex items-center gap-1.5 mb-1">
          <h2 id="currentCategoryTitle" class="text-xl font-semibold text-base">
            {{ store.currentCategory }}
          </h2>
          <button
            v-if="canRenameCategory"
            type="button"
            title="重命名分类"
            class="w-7 h-7 inline-flex items-center justify-center rounded-md border border-transparent bg-transparent text-[#6c757d] hover:bg-container hover:text-primary transition-all"
            @click="openRenameCategoryModal"
          >
            <NIcon size="16">
              <CreateOutline />
            </NIcon>
          </button>
        </div>
        <span id="fileCount" class="text-xs text-gray-500">
          {{ store.totalFiles }} 个文件
        </span>
      </div>

      <!-- 批量操作栏 -->
      <div
        v-if="checkedRowKeys.length > 0"
        class="flex items-center gap-2 w-full md:w-auto"
      >
        <span class="text-xs text-gray-500 mr-1">
          已选 {{ checkedRowKeys.length }} 项
        </span>
        <NButton
          v-if="canBatchMove"
          size="tiny"
          ghost
          type="primary"
          @click="showBatchMoveModal = true"
        >
          <template #icon>
            <NIcon><MoveOutline /></NIcon>
          </template>
          批量移动
        </NButton>
        <NButton
          size="tiny"
          ghost
          type="info"
          @click="showBatchShareModal = true"
        >
          <template #icon>
            <NIcon><LinkOutline /></NIcon>
          </template>
          批量分享
        </NButton>
        <NButton
          size="tiny"
          ghost
          type="error"
          @click="showBatchDeleteModal = true"
        >
          <template #icon>
            <NIcon><TrashOutline /></NIcon>
          </template>
          批量删除
        </NButton>
        <NButton size="tiny" quaternary @click="clearSelection"> 取消 </NButton>
      </div>

      <div
        class="flex flex-wrap items-center justify-between md:justify-start gap-2 md:gap-3 w-full md:w-auto"
      >
        <div
          class="flex items-center gap-1 bg-base px-1 py-1 rounded-md border border-base shadow-sm w-full md:w-auto"
        >
          <NInput
            :value="store.searchQuery"
            @update:value="handleSearchInput"
            @keydown.enter="store.handleSearch"
            placeholder="搜索文件..."
            size="tiny"
            class="w-full! md:w-40! text-xs!"
            :bordered="false"
            clearable
          >
            <template #prefix>
              <NIcon :component="SearchOutline" />
            </template>
          </NInput>
        </div>

        <div
          class="flex items-center gap-1 bg-base px-1 py-1 rounded-md border border-base shadow-sm"
        >
          <NSelect
            :value="store.sortBy"
            :options="sortOptions"
            @update:value="handleSortByChange"
            size="tiny"
            :show-arrow="false"
            class="w-20 !text-xs"
            :bordered="false"
          />
          <button
            class="w-6 h-6 inline-flex items-center justify-center rounded border border-transparent bg-transparent text-[#6c757d] hover:bg-container hover:text-primary transition-all"
            title="切换排序顺序"
            @click="handleSortOrderToggle"
          >
            <NIcon size="14">
              <ArrowUpOutline v-if="store.sortOrder === 'asc'" />
              <ArrowDownOutline v-else />
            </NIcon>
          </button>
        </div>

        <div
          class="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1 hidden md:block"
        ></div>

        <div
          class="flex items-center gap-1 bg-base px-1 py-1 rounded-md border border-base shadow-sm"
        >
          <button
            class="w-9 h-9 inline-flex items-center justify-center rounded-md border border-transparent bg-transparent text-[#6c757d] text-lg hover:bg-container hover:text-primary transition-all"
            :class="
              store.viewMode === 'grid'
                ? 'bg-primary/10! text-primary! border-primary'
                : 'border-transparent'
            "
            title="网格视图"
            @click="store.switchView('grid')"
          >
            <NIcon>
              <AppsOutline />
            </NIcon>
          </button>
          <button
            class="w-9 h-9 inline-flex items-center justify-center rounded-md border border-transparent bg-transparent text-[#6c757d] text-lg hover:bg-container hover:text-primary transition-all"
            :class="
              store.viewMode === 'list'
                ? 'bg-primary/10! text-primary! border-primary'
                : 'border-transparent'
            "
            title="列表视图"
            @click="store.switchView('list')"
          >
            <NIcon>
              <ReorderThreeOutline />
            </NIcon>
          </button>
          <button
            class="w-9 h-9 inline-flex items-center justify-center rounded-md border border-transparent bg-transparent text-[#6c757d] text-lg hover:bg-container hover:text-primary transition-all"
            title="刷新"
            @click="store.loadFiles"
          >
            <NIcon>
              <RefreshOutline />
            </NIcon>
          </button>
        </div>
      </div>
    </div>

    <div
      id="emptyState"
      class="text-center py-16 text-[#6c757d]"
      :class="store.files.length > 0 ? 'hidden' : ''"
    >
      <NIcon class="text-6xl text-[#dee2e6] mb-4 block mx-auto">
        <FolderOpenOutline />
      </NIcon>
      <h3 class="text-lg text-[#212529] mb-2">此分类暂无文件</h3>
      <p class="text-sm">点击右上角"上传文件"添加资源</p>
    </div>

    <div
      v-show="store.files.length > 0 && store.viewMode === 'grid'"
      id="fileGrid"
      :class="{ 'h-[calc(100vh-300px)] overflow-y-auto': !isMobile }"
      v-bind="!isMobile ? containerProps : {}"
    >
      <div v-if="!isMobile" v-bind="wrapperProps" class="max-w-full">
        <NImageGroup>
          <div
            v-for="row in virtualRows"
            :key="row.data.id"
            class="grid gap-5 mb-5 px-1"
            :style="{
              gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
            }"
          >
            <FileCard
              v-for="file in row.data.items"
              :key="file.path"
              :file="file"
              :file-url="fileUrl"
              :format-size="formatSize"
              :format-date="formatDate"
              @download="handleDownload"
              @delete="openDeleteModal"
            />
          </div>
        </NImageGroup>
      </div>

      <div
        v-else
        class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5 md:gap-5"
      >
        <NImageGroup>
          <FileCard
            v-for="file in store.files"
            :key="file.path"
            :file="file"
            :file-url="fileUrl"
            :format-size="formatSize"
            :format-date="formatDate"
            @download="handleDownload"
            @delete="openDeleteModal"
          />
        </NImageGroup>
      </div>
    </div>

    <NDataTable
      v-show="store.files.length > 0 && store.viewMode === 'list'"
      id="fileList"
      class="mt-4 rounded-xl shadow-sm"
      :columns="columns"
      :data="store.files"
      :row-key="(row: FileRow) => row.path"
      v-model:checked-row-keys="checkedRowKeys"
      :bordered="false"
      :single-line="false"
      :flex-height="!isMobile"
      :style="!isMobile ? { height: 'calc(100vh - 300px)' } : {}"
      :virtual-scroll="!isMobile"
    />

    <div
      v-if="store.totalFiles > store.pageSize"
      class="flex justify-center py-4 sticky bottom-0 z-2 backdrop-blur supports-[backdro8f9fa]/80 border-t border-[#e9ecef] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]"
    >
      <NPagination
        :page="store.page"
        :page-size="store.pageSize"
        :item-count="store.totalFiles"
        :page-slot="7"
        @update:page="store.handlePageChange"
      />
    </div>

    <NModal
      v-model:show="showDeleteModal"
      preset="dialog"
      title="确认删除"
      content="此操作不可恢复，确定要删除吗？"
      positive-text="删除"
      negative-text="取消"
      @positive-click="confirmDelete"
    />

    <RenameCategoryModal
      :visible="showRenameCategoryModal"
      :category="store.currentCategory"
      @close="showRenameCategoryModal = false"
    />

    <!-- 批量删除确认 -->
    <NModal
      v-model:show="showBatchDeleteModal"
      preset="dialog"
      title="批量删除"
      :content="`确定删除选中的 ${checkedRowKeys.length} 个文件吗？此操作不可恢复。`"
      positive-text="删除"
      negative-text="取消"
      :positive-button-props="{ loading: batchLoading }"
      @positive-click="confirmBatchDelete"
    />

    <!-- 批量移动弹窗 -->
    <NModal
      v-model:show="showBatchMoveModal"
      preset="dialog"
      title="批量移动"
      positive-text="移动"
      negative-text="取消"
      :positive-button-props="{
        loading: batchLoading,
        disabled: !batchMoveTarget,
      }"
      @positive-click="confirmBatchMove"
    >
      <div class="py-2">
        <p class="text-sm text-gray-500 mb-3">
          将选中的 {{ checkedRowKeys.length }} 个文件移动到：
        </p>
        <NSelect
          v-model:value="batchMoveTarget"
          :options="batchMoveOptions"
          placeholder="选择目标分类"
        />
      </div>
    </NModal>

    <!-- 批量分享弹窗 -->
    <CreateShareModal
      :visible="showBatchShareModal"
      :file-paths="checkedRowKeys"
      @close="showBatchShareModal = false"
    />
  </main>
</template>

<style scoped>
#fileGrid {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

#fileGrid::-webkit-scrollbar {
  display: none;
}

:deep(.n-data-table-base-table-body) {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

:deep(.n-data-table-base-table-body)::-webkit-scrollbar {
  display: none;
}
</style>
