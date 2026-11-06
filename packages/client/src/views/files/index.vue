<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  NButton,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NSpin,
  useMessage,
} from 'naive-ui';
import {
  CloudUploadOutline,
  GridOutline,
  ListOutline,
  RefreshOutline,
  SearchOutline,
  ServerOutline,
  SettingsOutline,
  ShareSocialOutline,
  SwapHorizontalOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { FileItem, ShareLink } from '@vakao/shared';
import {
  batchDelete,
  batchMove,
  deleteFile,
  getFileConfig,
  listFiles,
  renameFile,
} from '@/api/files';
import PageHeader from '@/components/common/page-header.vue';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';
import CategoryPanel from '@/layouts/components/category-panel.vue';
import {
  buildFileUrl,
  buildSharePageUrl,
  buildThumbUrl,
} from '@/utils/file-url';
import { getErrorMessage } from '@/utils/http';
import { formatBytes, isImage } from '@/utils/file-types';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import { useIndexStatusStore } from '@/stores/modules/index-status';
import { useOverviewStore } from '@/stores/modules/overview';
import FileCard from './components/file-card.vue';
import UploadPanel from './components/upload-panel.vue';
import RenameFileModal from './components/rename-file-modal.vue';
import MoveFileModal from './components/move-file-modal.vue';
import QuickShareModal from './components/quick-share-modal.vue';
import RootManagerModal from './components/root-manager-modal.vue';
import ShareQrModal from '@/views/shares/components/share-qr-modal.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import PreviewDialog from '@/components/preview/preview-dialog.vue';
import type { PreviewTarget } from '@/components/preview/types';

/**
 * 文件库：网格 / 列表、搜索、排序、分页、多选批量操作、上传、预览入口
 * 分类来自 Category Panel（categoryStore.activeCategory），未选择时回落到后端下发的默认分类
 */
const appStore = useAppStore();
const categoryStore = useCategoryStore();
const indexStatusStore = useIndexStatusStore();
const overview = useOverviewStore();
const message = useMessage();

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
const { loading, loadingText, begin: beginLoading } = useListLoading({ page });
const error = ref('');
const selected = ref<Set<string>>(new Set());
/** 内容区滚动容器：翻页后回到顶部 */
const scrollRef = ref<HTMLElement | null>(null);

const sortOptions = [
  { label: '修改时间', value: 'mtime' },
  { label: '名称', value: 'name' },
  { label: '大小', value: 'size' },
];

let loadSeq = 0;

async function load() {
  const seq = ++loadSeq;
  loading.value = true;
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
    error.value = getErrorMessage(e, '文件列表加载失败');
    items.value = [];
    total.value = 0;
  } finally {
    if (seq === loadSeq) loading.value = false;
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

/** 顶部刷新按钮：进入加载态，完成后提示本次刷新到的文件数量 */
const refreshing = ref(false);

async function refreshFiles() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await load();
    if (error.value) {
      message.error(error.value);
      return;
    }
    message.success(`已刷新 · 当前分类 ${total.value} 个文件`);
  } catch (e) {
    message.error(getErrorMessage(e, '刷新失败'));
  } finally {
    refreshing.value = false;
  }
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
  scrollRef.value?.scrollTo({ top: 0 });
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

// —— 预览 ——
const previewShow = ref(false);
const previewIndex = ref(0);
const previewTargets = ref<PreviewTarget[]>([]);

function toTarget(file: FileItem): PreviewTarget {
  return {
    filename: file.name,
    // 图片走高分辨率档，其余类型仍需原始内容交给各自的预览组件
    src: isImage(file.name)
      ? buildThumbUrl({ code: file.code }, 'preview')
      : buildFileUrl({ code: file.code }),
    downloadSrc: buildFileUrl({
      code: file.code,
      download: true,
    }),
    size: file.size,
  };
}

function openPreview(file: FileItem) {
  if (isImage(file.name)) {
    const images = items.value.filter((i) => isImage(i.name));
    previewTargets.value = images.map(toTarget);
    previewIndex.value = Math.max(
      0,
      images.findIndex((i) => i.path === file.path),
    );
  } else {
    previewTargets.value = [toTarget(file)];
    previewIndex.value = 0;
  }
  previewShow.value = true;
}

// —— 复制直链 ——
async function copyLink(file: FileItem) {
  const url = buildFileUrl({ code: file.code });
  try {
    await navigator.clipboard.writeText(url);
    message.success('直链已复制');
  } catch {
    message.error('复制失败，请检查浏览器剪贴板权限');
  }
}

// —— 重命名 ——
const renameShow = ref(false);
const renameTarget = ref<FileItem | null>(null);
const renameLoading = ref(false);

function openRename(file: FileItem) {
  renameTarget.value = file;
  renameShow.value = true;
}

async function submitRename(newName: string) {
  const file = renameTarget.value;
  if (!file) return;
  renameLoading.value = true;
  try {
    await renameFile(rootId.value, category.value, file.path, newName);
    message.success('已重命名');
    renameShow.value = false;
    await load();
    void categoryStore.loadCategories(rootId.value, { silent: true });
  } catch (e) {
    message.error(getErrorMessage(e, '重命名失败'));
  } finally {
    renameLoading.value = false;
  }
}

// —— 移动 ——
const moveShow = ref(false);
const movePaths = ref<string[]>([]);
const moveLoading = ref(false);

function openMove(file: FileItem) {
  movePaths.value = [file.path];
  moveShow.value = true;
}

function openBatchMove() {
  movePaths.value = [...selected.value];
  moveShow.value = true;
}

async function submitMove(targetCategory: string) {
  moveLoading.value = true;
  try {
    const result = await batchMove(
      rootId.value,
      category.value,
      movePaths.value,
      targetCategory,
    );
    const failed = result.results.filter((r) => !r.success);
    if (failed.length > 0) {
      message.warning(
        `已移动 ${result.movedCount} 个，${failed.length} 个失败：${failed[0].error ?? '未知原因'}`,
      );
    } else {
      message.success(
        `已移动 ${result.movedCount} 个文件到「${targetCategory}」`,
      );
    }
    moveShow.value = false;
    selected.value = new Set();
    await load();
    void categoryStore.loadCategories(rootId.value, { silent: true });
  } catch (e) {
    message.error(getErrorMessage(e, '移动失败'));
  } finally {
    moveLoading.value = false;
  }
}

// —— 删除 ——
const deleteShow = ref(false);
const deletePaths = ref<string[]>([]);
const deleteLabel = ref('');
const deleteLoading = ref(false);

function openDelete(file: FileItem) {
  deletePaths.value = [file.path];
  deleteLabel.value = `「${file.name}」`;
  deleteShow.value = true;
}

function openBatchDelete() {
  deletePaths.value = [...selected.value];
  deleteLabel.value = `${selected.value.size} 个文件`;
  deleteShow.value = true;
}

async function confirmDelete() {
  deleteLoading.value = true;
  try {
    if (deletePaths.value.length === 1) {
      await deleteFile(rootId.value, category.value, deletePaths.value[0]);
    } else {
      await batchDelete(rootId.value, category.value, deletePaths.value);
    }
    message.success(`${deleteLabel.value}已删除`);
    deleteShow.value = false;
    selected.value = new Set();
    await load();
    void categoryStore.loadCategories(rootId.value, { silent: true });
  } catch (e) {
    message.error(getErrorMessage(e, '删除失败'));
  } finally {
    deleteLoading.value = false;
  }
}

// —— 上传 ——
const uploadShow = ref(false);

async function onUploaded() {
  await load();
  void categoryStore.loadCategories(rootId.value, { silent: true });
}

// —— 分享（单文件 / 多选批量） ——
const shareShow = ref(false);
const sharePaths = ref<string[]>([]);

function openShare(file: FileItem) {
  sharePaths.value = [file.path];
  shareShow.value = true;
}

function openBatchShare() {
  if (selected.value.size === 0) {
    message.warning('请先选择文件');
    return;
  }
  sharePaths.value = [...selected.value];
  shareShow.value = true;
}

// —— 创建成功后的二维码（与「分享管理」复用同一组件） ——
const qrShow = ref(false);
const qrUrl = ref('');
const qrFilename = ref('');
const shareLabel = computed(() =>
  sharePaths.value.length > 1
    ? `文件集合-${sharePaths.value.length}个`
    : (sharePaths.value[0]?.split('/').pop() ?? 'share'),
);

function onShareCreated(link: ShareLink) {
  // 单文件与多选批量都走这里：同步侧栏「分享管理」徽标，无需等路由切换
  void overview.refresh();
  qrUrl.value = buildSharePageUrl(link.token);
  qrFilename.value = `${shareLabel.value}-qr.png`;
  qrShow.value = true;
}
</script>

<template>
  <div class="h-full flex flex-col gap-3 animate-fade-up">
    <!-- 页头 + 工具条（对齐原型：topbar + toolbar 两段） -->
    <PageHeader title="文件库" :description="headerDescription">
      <template #actions>
        <NButton
          size="small"
          quaternary
          :loading="refreshing"
          :disabled="refreshing"
          @click="refreshFiles"
        >
          <template #icon
            ><NIcon><RefreshOutline /></NIcon>
          </template>
          刷新
        </NButton>
        <NButton type="primary" size="small" @click="uploadShow = true">
          <template #icon
            ><NIcon><CloudUploadOutline /></NIcon>
          </template>
          上传文件
        </NButton>
      </template>
    </PageHeader>

    <!-- 分类 chips（原分类面板的入口迁移到页内） -->
    <div
      class="flex flex-nowrap sm:flex-wrap items-center gap-2 overflow-x-auto scrollbar-hidden pb-1"
    >
      <NSelect
        :value="rootId"
        :options="rootOptions"
        size="small"
        class="w-36 sm:w-40 shrink-0"
        @update:value="onRootChange"
      />
      <button
        v-for="c in categories"
        :key="c.name"
        type="button"
        class="h-7 px-3 rounded-full border border-solid text-12px cursor-pointer transition-colors shrink-0"
        :class="
          category === c.name
            ? 'bg-brand-600 text-white border-transparent'
            : 'bg-[var(--mat-chip)] text-ink-sub border-[var(--mat-line)] hover:text-ink'
        "
        @click="categoryStore.setActiveCategory(c.name)"
      >
        {{ c.name }}
        <span class="tabular-nums opacity-70">{{ c.fileCount }}</span>
      </button>
      <button
        type="button"
        class="shrink-0 whitespace-nowrap h-7 px-3 rounded-full border border-dashed border-[var(--mat-line)] bg-transparent text-12px text-ink-sub cursor-pointer transition-colors hover:text-ink"
        @click="manageShow = true"
      >
        + 新建分类
      </button>
      <button
        type="button"
        class="ml-auto shrink-0 h-7 px-3 rounded-full border border-solid border-[var(--mat-line)] bg-[var(--mat-chip)] text-12px text-ink-sub cursor-pointer transition-colors hover:text-ink flex items-center gap-1.5"
        @click="manageShow = true"
      >
        <NIcon :size="13"><SettingsOutline /></NIcon>
        管理分类
      </button>
      <button
        type="button"
        class="shrink-0 h-7 px-3 rounded-full border border-solid border-[var(--mat-line)] bg-[var(--mat-chip)] text-12px text-ink-sub cursor-pointer transition-colors hover:text-ink flex items-center gap-1.5"
        @click="rootMgrShow = true"
      >
        <NIcon :size="13"><ServerOutline /></NIcon>
        管理根目录
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <NInput
        v-model:value="q"
        size="small"
        clearable
        placeholder="搜索文件名 / 路径"
        class="w-full! sm:w-64!"
      >
        <template #prefix>
          <NIcon :size="15"><SearchOutline /></NIcon>
        </template>
      </NInput>

      <NSelect
        v-model:value="sort"
        :options="sortOptions"
        size="small"
        class="w-32"
      />
      <NButton
        size="small"
        quaternary
        circle
        :title="order === 'asc' ? '升序' : '降序'"
        @click="toggleOrder"
      >
        {{ order === 'asc' ? '↑' : '↓' }}
      </NButton>

      <div class="ml-auto flex items-center gap-1">
        <NButton
          size="small"
          circle
          quaternary
          :type="viewMode === 'grid' ? 'primary' : 'default'"
          @click="viewMode = 'grid'"
        >
          <template #icon
            ><NIcon><GridOutline /></NIcon>
          </template>
        </NButton>
        <NButton
          size="small"
          circle
          quaternary
          :type="viewMode === 'list' ? 'primary' : 'default'"
          @click="viewMode = 'list'"
        >
          <template #icon
            ><NIcon><ListOutline /></NIcon>
          </template>
        </NButton>
      </div>
    </div>

    <!-- 批量操作条 -->
    <div
      v-if="selected.size > 0"
      class="glass-chip self-start px-3 py-2 flex items-center gap-3"
    >
      <span class="text-12px text-ink">已选 {{ selected.size }} 项</span>
      <NButton size="tiny" quaternary @click="toggleSelectAll">
        {{ allSelected ? '取消全选' : '全选本页' }}
      </NButton>
      <NButton size="tiny" quaternary @click="openBatchMove">
        <template #icon
          ><NIcon :size="14"><SwapHorizontalOutline /></NIcon
        ></template>
        移动
      </NButton>
      <NButton size="tiny" quaternary @click="openBatchShare">
        <template #icon
          ><NIcon :size="14"><ShareSocialOutline /></NIcon
        ></template>
        创建分享（{{ selected.size }} 个文件）
      </NButton>
      <NButton size="tiny" quaternary type="error" @click="openBatchDelete">
        <template #icon
          ><NIcon :size="14"><TrashOutline /></NIcon
        ></template>
        删除
      </NButton>
      <NButton size="tiny" quaternary @click="selected = new Set()"
        >取消</NButton
      >
    </div>

    <!-- 内容区：加载遮罩相对可视区域居中，不随内容高度或滚动位置偏移 -->
    <div class="relative flex-1 min-h-0">
      <div ref="scrollRef" class="h-full overflow-y-auto pr-1">
        <div v-if="error" class="glass-panel px-6 py-10 text-center">
          <p class="m-0 text-13px text-ink-sub">{{ error }}</p>
          <NButton class="mt-3" size="small" @click="reload">重试</NButton>
        </div>

        <div
          v-else-if="!loading && items.length === 0"
          class="glass-panel px-6 py-16 flex flex-col items-center gap-3"
        >
          <template v-if="scanning && !q">
            <NSpin size="small" />
            <p class="m-0 text-13px text-ink-sub">
              正在扫描 · 已处理
              <span class="tabular-nums">{{ scannedFiles }}</span> 个文件
            </p>
            <p
              v-if="scanningDir"
              class="m-0 max-w-full truncate text-11px text-ink-sub font-mono"
            >
              {{ scanningDir }}
            </p>
          </template>
          <template v-else>
            <NEmpty
              :description="q ? `没有匹配「${q}」的文件` : '当前分类还没有文件'"
            />
            <NButton v-if="q" size="small" @click="q = ''">清除搜索</NButton>
            <NButton
              v-else
              size="small"
              type="primary"
              @click="uploadShow = true"
            >
              上传第一个文件
            </NButton>
          </template>
        </div>

        <div
          v-else-if="viewMode === 'grid'"
          class="content-grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(212px,1fr))]"
        >
          <FileCard
            v-for="file in items"
            :key="file.path"
            :file="file"
            :selected="selected.has(file.path)"
            mode="grid"
            @toggle-select="toggleSelect"
            @open="openPreview"
            @rename="openRename"
            @move="openMove"
            @share="openShare"
            @copy-link="copyLink"
            @remove="openDelete"
          />
        </div>

        <div v-else class="flex flex-col gap-2">
          <FileCard
            v-for="file in items"
            :key="file.path"
            :file="file"
            :selected="selected.has(file.path)"
            mode="list"
            @toggle-select="toggleSelect"
            @open="openPreview"
            @rename="openRename"
            @move="openMove"
            @share="openShare"
            @copy-link="copyLink"
            @remove="openDelete"
          />
        </div>
      </div>

      <ListLoading :show="loading" :text="loadingText" />
    </div>

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
