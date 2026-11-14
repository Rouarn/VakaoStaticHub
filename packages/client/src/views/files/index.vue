<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { NButton, NIcon, NModal, NPagination } from 'naive-ui';
import { CloudUploadOutline } from '@vicons/ionicons5';
import type { FileItem } from '@vakao/shared';
import { getFileConfig, listFiles } from '@/api/files';
import PageHeader from '@/components/common/page-header.vue';
import RefreshButton from '@/components/common/refresh-button.vue';
import { useListLoading } from '@/composables/use-list-loading';
import CategoryPanel from '@/layouts/components/category-panel.vue';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import { useIndexStatusStore } from '@/stores/modules/index-status';
import UploadPanel from './components/upload-panel.vue';
import RenameFileModal from './components/rename-file-modal.vue';
import MoveFileModal from './components/move-file-modal.vue';
import QuickShareModal from './components/quick-share-modal.vue';
import RootManagerModal from './components/root-manager-modal.vue';
import ShareQrModal from '@/views/shares/components/share-qr-modal.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import FilesToolbar from './components/files-toolbar.vue';
import FileList from './components/file-list.vue';
import { useFileActions } from './composables/use-file-actions';

/**
 * 文件库：网格 / 列表、搜索、排序、分页、多选批量操作、上传、预览入口
 * 分类来自 Category Panel（categoryStore.activeCategory），未选择时回落到后端下发的默认分类
 */
const appStore = useAppStore();
const categoryStore = useCategoryStore();
const indexStatusStore = useIndexStatusStore();

const defaultCategory = ref('TemporaryFile');
const manageShow = ref(false);
const rootMgrShow = ref(false);

const rootId = computed(() => appStore.activeRootId);
/** 当前根目录的索引状态：扫描中时列表空态改为进度提示 */
const rootIndexStatus = computed(() => indexStatusStore.statusOf(rootId.value));
const scanning = computed(() => rootIndexStatus.value?.state === 'running');
const scannedFiles = computed(() => rootIndexStatus.value?.scannedFiles ?? 0);
const scanningDir = computed(() => rootIndexStatus.value?.currentDir ?? '');
const category = computed(
  () => categoryStore.activeCategory || defaultCategory.value,
);
const categories = computed(() => categoryStore.categoriesOf(rootId.value));
const rootOptions = computed(() =>
  categoryStore.roots.map((root) => ({ label: root.name, value: root.id })),
);
/** 当前分类的总大小（来自分类统计接口），用于页头副标题 */
const categoryTotalSize = computed(
  () =>
    categories.value.find((c) => c.name === category.value)?.totalSize ?? null,
);
const headerDescription = computed(() => {
  const size = categoryTotalSize.value;
  return `${total.value} 个文件${size ? ` · ${formatBytes(size)}` : ''}`;
});

/** 没有有效分类时自动选第一个：避免回落到不存在的默认分类导致 0 文件 */
function ensureActiveCategory() {
  const list = categories.value;
  if (list.length === 0) return false;
  const active = categoryStore.activeCategory;
  if (active && list.some((c) => c.name === active)) return false;
  categoryStore.setActiveCategory(list[0].name);
  return true;
}

/** 切换根目录：加载分类并自动选中第一个，避免落到旧分类 */
async function onRootChange(id: string) {
  appStore.setActiveRoot(id);
  await categoryStore.loadCategories(id);
  categoryStore.setActiveCategory(categories.value[0]?.name ?? null);
}

const items = ref<FileItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(24);
const q = ref('');
const sort = ref<'name' | 'size' | 'mtime'>('mtime');
const order = ref<'asc' | 'desc'>('desc');
const viewMode = ref<'grid' | 'list'>('grid');

/** 加载态与中文提示：文案规则见 useListLoading（翻页时带页码） */
const {
  loading,
  loadingText,
  refreshing,
  justRefreshed,
  begin: beginLoading,
  refresh,
} = useListLoading({ page });
const error = ref('');
const selected = ref<Set<string>>(new Set());
/** 内容区滚动容器：翻页后回到顶部 */
const listRef = ref<InstanceType<typeof FileList> | null>(null);

let loadSeq = 0;

/**
 * silent=true 用于手动刷新：不显示遮罩、失败时不覆盖当前列表，
 * 错误抛给 useListLoading.refresh 统一提示。
 */
async function load(options: { silent?: boolean } = {}) {
  const seq = ++loadSeq;
  if (!options.silent) loading.value = true;
  error.value = '';
  try {
    const result = await listFiles(rootId.value, category.value, {
      page: page.value,
      pageSize: pageSize.value,
      q: q.value.trim() || undefined,
      sort: sort.value,
      order: order.value,
    });
    if (seq !== loadSeq) return;
    items.value = result.items;
    total.value = result.total;
    // 翻页后清理已不在当前页的选中项
    const visible = new Set(result.items.map((i) => i.path));
    selected.value = new Set([...selected.value].filter((p) => visible.has(p)));
  } catch (e) {
    if (seq !== loadSeq) return;
    if (options.silent) throw e;
    error.value = getErrorMessage(e, '文件列表加载失败');
    items.value = [];
    total.value = 0;
  } finally {
    if (!options.silent && seq === loadSeq) loading.value = false;
  }
}

/** 合并同一轮初始化里的多次加载（分类兜底 + watcher 会同时触发） */
let loadTimer: number | null = null;
function scheduleLoad() {
  if (loadTimer !== null) return;
  loadTimer = window.setTimeout(() => {
    loadTimer = null;
    void load();
  }, 0);
}

const reload = () => scheduleLoad();

/** 顶部刷新按钮：不走遮罩，图标旋转 → 对勾 → 箭头 */
function refreshFiles() {
  void refresh(() => load({ silent: true }), '刷新失败');
}

onMounted(async () => {
  void indexStatusStore.start();
  try {
    const config = await getFileConfig();
    defaultCategory.value = config.defaultCategory;
  } catch {
    // 配置读取失败时保留本地兜底名，不阻断列表
  }
  if (categoryStore.roots.length === 0) await categoryStore.loadRoots();
  // 优先恢复上次分类；根目录或分类失效、接口为空时安静回退到默认
  const restored = await categoryStore.restoreSelection();
  if (!restored) {
    // 当前根目录可能已被删除，回退到第一个可用根目录
    if (
      categoryStore.roots.length > 0 &&
      !categoryStore.roots.some((root) => root.id === rootId.value)
    ) {
      appStore.setActiveRoot(categoryStore.roots[0].id);
    }
    if (categoryStore.categoriesOf(rootId.value).length === 0) {
      await categoryStore.loadCategories(rootId.value);
    }
    ensureActiveCategory();
  }
  scheduleLoad();
});

watch(categories, () => ensureActiveCategory(), { immediate: true });

watch(rootId, async () => {
  page.value = 1;
  // 先清空旧列表：否则切换根目录/分类的请求返回前，
  // 旧文件会带着新分类拼出错误的缩略图 URL（404）
  beginLoading(() => {
    items.value = [];
    total.value = 0;
    selected.value = new Set();
  });
  await categoryStore.loadCategories(rootId.value);
  if (!ensureActiveCategory()) scheduleLoad();
});

watch(category, () => {
  page.value = 1;
  beginLoading(() => {
    items.value = [];
    total.value = 0;
    selected.value = new Set();
  });
  scheduleLoad();
});

watch([page, pageSize, sort, order], () => {
  // 先清空当前页再发请求：否则页码已经变了、列表还是上一页，
  // 快速翻页时会长时间看到「页码与内容不一致」。
  beginLoading(() => {
    items.value = [];
    selected.value = new Set();
    error.value = '';
  });
  listRef.value?.scrollToTop();
  scheduleLoad();
});

// 当前根目录扫描结束（成功或失败）后自动刷新一次列表
watch(
  () => rootIndexStatus.value?.state,
  (state, prev) => {
    if (prev === 'running' && (state === 'done' || state === 'failed')) {
      void categoryStore.loadCategories(rootId.value, { silent: true });
      scheduleLoad();
    }
  },
);

watch(
  q,
  useDebounceFn(() => {
    page.value = 1;
    scheduleLoad();
  }, 300),
);

// —— 选择 ——
function toggleSelect(path: string) {
  const next = new Set(selected.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selected.value = next;
}

const allSelected = computed(
  () => items.value.length > 0 && selected.value.size === items.value.length,
);

function toggleSelectAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(items.value.map((i) => i.path));
}

// —— 详情操作 ——
function toggleOrder() {
  order.value = order.value === 'asc' ? 'desc' : 'asc';
}

// —— 预览 / 复制 / 重命名 / 移动 / 删除 / 上传 / 分享 ——
const {
  previewShow,
  previewIndex,
  previewTargets,
  openPreview,
  copyLink,
  copyPreviewLink,
  renameShow,
  renameTarget,
  renameLoading,
  openRename,
  submitRename,
  moveShow,
  movePaths,
  moveLoading,
  openMove,
  openBatchMove,
  submitMove,
  deleteShow,
  deleteLabel,
  deleteLoading,
  openDelete,
  openBatchDelete,
  confirmDelete,
  uploadShow,
  onUploaded,
  shareShow,
  sharePaths,
  openShare,
  openBatchShare,
  qrShow,
  qrUrl,
  qrFilename,
  onShareCreated,
} = useFileActions({
  rootId,
  category,
  items,
  selected,
  reload: () => load(),
  reloadCategories: () =>
    void categoryStore.loadCategories(rootId.value, { silent: true }),
});
</script>

<template>
  <div class="h-full flex flex-col gap-3">
    <!-- 页头 + 工具条（对齐原型：topbar + toolbar 两段） -->
    <PageHeader title="文件库" :description="headerDescription">
      <template #actions>
        <RefreshButton
          :loading="refreshing"
          :success="justRefreshed"
          @click="refreshFiles"
        />
        <NButton type="primary" size="small" @click="uploadShow = true">
          <template #icon
            ><NIcon><CloudUploadOutline /></NIcon>
          </template>
          上传文件
        </NButton>
      </template>
    </PageHeader>

    <FilesToolbar
      :root-id="rootId"
      :root-options="rootOptions"
      :categories="categories"
      :category="category"
      :q="q"
      :sort="sort"
      :order="order"
      :view-mode="viewMode"
      :selected-count="selected.size"
      :all-selected="allSelected"
      @root-change="onRootChange"
      @select-category="categoryStore.setActiveCategory"
      @manage-category="manageShow = true"
      @manage-root="rootMgrShow = true"
      @update:q="q = $event"
      @update:sort="sort = $event"
      @update:view-mode="viewMode = $event"
      @toggle-order="toggleOrder"
      @select-all="toggleSelectAll"
      @batch-move="openBatchMove"
      @batch-share="openBatchShare"
      @batch-delete="openBatchDelete"
      @clear-selection="selected = new Set()"
    />

    <FileList
      ref="listRef"
      :error="error"
      :loading="loading"
      :loading-text="loadingText"
      :scanning="scanning"
      :scanned-files="scannedFiles"
      :scanning-dir="scanningDir"
      :q="q"
      :files="items"
      :selected="selected"
      :view-mode="viewMode"
      @retry="reload"
      @clear-search="q = ''"
      @upload="uploadShow = true"
      @toggle-select="toggleSelect"
      @open="openPreview"
      @rename="openRename"
      @move="openMove"
      @share="openShare"
      @copy-link="copyLink"
      @copy-preview-link="copyPreviewLink"
      @remove="openDelete"
    />

    <!-- 分页（无数据时隐藏，避免 0 条却显示页码） -->
    <footer
      v-if="total > 0"
      class="flex flex-wrap items-center justify-between sm:justify-end gap-2 px-1 pb-1"
    >
      <NPagination
        :page-slot="5"
        v-model:page="page"
        v-model:page-size="pageSize"
        :item-count="total"
        :page-sizes="[24, 48, 96, 200]"
        :disabled="loading"
        show-size-picker
      />
    </footer>

    <!-- 分类管理（复用原分类面板，仅作为弹窗内容） -->
    <NModal
      v-model:show="manageShow"
      preset="card"
      title="资源分类"
      style="width: 420px"
      :bordered="false"
    >
      <div class="h-110">
        <CategoryPanel embedded />
      </div>
    </NModal>

    <!-- 根目录管理 -->
    <RootManagerModal v-model:show="rootMgrShow" />

    <!-- 上传 -->
    <NModal
      v-model:show="uploadShow"
      preset="card"
      title="上传文件"
      class="max-w-150"
      :bordered="false"
    >
      <UploadPanel
        :root-id="rootId"
        :category="category"
        :categories="categories"
        @uploaded="onUploaded"
        @close="uploadShow = false"
      />
    </NModal>

    <RenameFileModal
      v-model:show="renameShow"
      :current-name="renameTarget?.name ?? ''"
      :loading="renameLoading"
      @submit="submitRename"
    />

    <MoveFileModal
      v-model:show="moveShow"
      :categories="categories"
      :current-category="category"
      :count="movePaths.length"
      :loading="moveLoading"
      @submit="submitMove"
    />

    <ConfirmModal
      v-model:show="deleteShow"
      title="删除文件"
      :content="`将永久删除 ${deleteLabel}，该操作不可恢复。`"
      :loading="deleteLoading"
      @confirm="confirmDelete"
    />

    <PreviewDialog
      v-model:show="previewShow"
      v-model:index="previewIndex"
      :files="previewTargets"
    />

    <!-- 快速分享（单文件 / 多选批量） -->
    <QuickShareModal
      v-model:show="shareShow"
      :root-id="rootId"
      :category="category"
      :paths="sharePaths"
      @created="onShareCreated"
    />

    <ShareQrModal v-model:show="qrShow" :url="qrUrl" :filename="qrFilename" />
  </div>
</template>
