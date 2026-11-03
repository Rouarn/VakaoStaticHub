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
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  CloudUploadOutline,
  GridOutline,
  ListOutline,
  RefreshOutline,
  SearchOutline,
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
import { buildFileUrl, buildSharePageUrl } from '@/utils/file-url';
import { getErrorMessage } from '@/utils/http';
import { isImage } from '@/utils/file-types';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import FileCard from './components/file-card.vue';
import UploadPanel from './components/upload-panel.vue';
import RenameFileModal from './components/rename-file-modal.vue';
import MoveFileModal from './components/move-file-modal.vue';
import QuickShareModal from './components/quick-share-modal.vue';
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
const message = useMessage();

const defaultCategory = ref('TemporaryFile');

const rootId = computed(() => appStore.activeRootId);
const category = computed(
  () => categoryStore.activeCategory || defaultCategory.value,
);
const categories = computed(() => categoryStore.categoriesOf(rootId.value));

const items = ref<FileItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(24);
const q = ref('');
const sort = ref<'name' | 'size' | 'mtime'>('mtime');
const order = ref<'asc' | 'desc'>('desc');
const viewMode = ref<'grid' | 'list'>('grid');

const loading = ref(false);
const error = ref('');
const selected = ref<Set<string>>(new Set());

const sortOptions = [
  { label: '修改时间', value: 'mtime' },
  { label: '名称', value: 'name' },
  { label: '大小', value: 'size' },
];

async function load() {
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
    items.value = result.items;
    total.value = result.total;
    // 翻页后清理已不在当前页的选中项
    const visible = new Set(result.items.map((i) => i.path));
    selected.value = new Set([...selected.value].filter((p) => visible.has(p)));
  } catch (e) {
    error.value = getErrorMessage(e, '文件列表加载失败');
    items.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

const reload = () => void load();

onMounted(async () => {
  try {
    const config = await getFileConfig();
    defaultCategory.value = config.defaultCategory;
  } catch {
    // 配置读取失败时保留本地兜底名，不阻断列表
  }
  if (categoryStore.roots.length === 0) await categoryStore.loadRoots();
  if (categoryStore.categoriesOf(rootId.value).length === 0) {
    await categoryStore.loadCategories(rootId.value);
  }
  await load();
});

watch(rootId, () => {
  page.value = 1;
  selected.value = new Set();
  // 先清空旧列表：否则切换根目录/分类的请求返回前，
  // 旧文件会带着新分类拼出错误的缩略图 URL（404）
  items.value = [];
  total.value = 0;
  void categoryStore.loadCategories(rootId.value);
  void load();
});

watch(category, () => {
  page.value = 1;
  selected.value = new Set();
  items.value = [];
  total.value = 0;
  void load();
});

watch([page, pageSize, sort, order], () => void load());

watch(
  q,
  useDebounceFn(() => {
    page.value = 1;
    void load();
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
  const params = {
    rootId: rootId.value,
    category: category.value,
    relPath: file.path,
  };
  return {
    filename: file.name,
    src: buildFileUrl(params),
    downloadSrc: buildFileUrl({ ...params, download: true }),
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
  const url = buildFileUrl({
    rootId: rootId.value,
    category: category.value,
    relPath: file.path,
  });
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
  qrUrl.value = buildSharePageUrl(link.token);
  qrFilename.value = `${shareLabel.value}-qr.png`;
  qrShow.value = true;
}
</script>

<template>
  <div class="h-full flex flex-col gap-4 animate-fade-up">
    <!-- 工具条 -->
    <header class="glass-panel px-4 py-3 flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <p class="m-0 text-15px font-600 text-ink truncate leading-tight">
          {{ category }}
        </p>
        <p class="m-0 mt-0.5 text-12px text-ink-sub">
          {{ categoryStore.rootName(rootId) }} · 共 {{ total }} 个文件
        </p>
      </div>

      <NInput
        v-model:value="q"
        size="small"
        clearable
        placeholder="搜索文件名 / 路径"
        class="w-56 ml-auto"
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
      <NTooltip :delay="300">
        <template #trigger>
          <NButton size="small" quaternary @click="toggleOrder">
            {{ order === 'asc' ? '升序' : '降序' }}
          </NButton>
        </template>
        切换排序方向
      </NTooltip>

      <div class="flex items-center gap-1">
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton
              size="small"
              circle
              :type="viewMode === 'grid' ? 'primary' : 'default'"
              quaternary
              @click="viewMode = 'grid'"
            >
              <template #icon
                ><NIcon><GridOutline /></NIcon
              ></template>
            </NButton> </template
          >网格视图</NTooltip
        >
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton
              size="small"
              circle
              :type="viewMode === 'list' ? 'primary' : 'default'"
              quaternary
              @click="viewMode = 'list'"
            >
              <template #icon
                ><NIcon><ListOutline /></NIcon
              ></template>
            </NButton> </template
          >列表视图</NTooltip
        >
        <NTooltip :delay="300"
          ><template #trigger>
            <NButton size="small" circle quaternary @click="reload">
              <template #icon
                ><NIcon><RefreshOutline /></NIcon
              ></template>
            </NButton> </template
          >刷新</NTooltip
        >
      </div>

      <NButton type="primary" size="small" @click="uploadShow = true">
        <template #icon
          ><NIcon><CloudUploadOutline /></NIcon
        ></template>
        上传文件
      </NButton>
    </header>

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

    <!-- 内容区 -->
    <div class="flex-1 min-h-0 overflow-y-auto pr-1">
      <NSpin :show="loading">
        <div v-if="error" class="glass-panel px-6 py-10 text-center">
          <p class="m-0 text-13px text-ink-sub">{{ error }}</p>
          <NButton class="mt-3" size="small" @click="reload">重试</NButton>
        </div>

        <div
          v-else-if="!loading && items.length === 0"
          class="glass-panel px-6 py-16 flex flex-col items-center gap-3"
        >
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
        </div>

        <div
          v-else-if="viewMode === 'grid'"
          class="content-grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))]"
        >
          <FileCard
            v-for="file in items"
            :key="file.path"
            :file="file"
            :root-id="rootId"
            :category="category"
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
            :root-id="rootId"
            :category="category"
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
      </NSpin>
    </div>

    <!-- 分页（无数据时隐藏，避免 0 条却显示页码） -->
    <footer
      v-if="total > 0"
      class="glass-panel px-4 py-2 flex items-center justify-end gap-2"
    >
      <NPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :item-count="total"
        :page-sizes="[24, 48, 96, 200]"
        show-size-picker
      />
    </footer>

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
