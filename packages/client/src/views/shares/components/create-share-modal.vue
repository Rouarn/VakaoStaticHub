<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  NButton,
  NCheckbox,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  useMessage,
} from 'naive-ui';
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  InformationCircleOutline,
  SearchOutline,
} from '@vicons/ionicons5';
import type { FileItem, ShareLink } from '@vakao/shared';
import { RequestError } from '@vakao/axios';
import { createShare } from '@/api/shares';
import { listFiles } from '@/api/files';
import { getErrorMessage } from '@/utils/http';
import { formatBytes, formatTime } from '@/utils/file-types';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';

/**
 * 创建分享弹窗：选择根目录/分类、勾选文件、备注、密码、有效期与次数上限。
 * 文件列表独立分页；创建成功后由父级打开二维码并刷新列表。
 */
const emit = defineEmits<{
  created: [ShareLink];
}>();

const appStore = useAppStore();
const categoryStore = useCategoryStore();
const message = useMessage();

const createShow = ref(false);
const creating = ref(false);
const form = ref({
  rootId: '',
  category: '',
  remark: '',
  requirePassword: false,
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
/** 弹窗内文件列表的加载态与中文提示 */
const {
  loading: filesLoading,
  loadingText: filesLoadingText,
  begin: beginFilesLoading,
} = useListLoading({ text: '正在加载文件…' });
const filesError = ref('');

const roots = computed(() => categoryStore.roots);
const categories = computed(() =>
  categoryStore.categoriesOf(form.value.rootId),
);
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

/** 文件列表请求序号：打开弹窗时 root/category 的 watcher 会与 open 并发触发同一 key 请求，
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

/** 清空文件选择列表：切换搜索 / 分类 / 页码时避免旧数据残留 */
function clearFileItems() {
  fileItems.value = [];
}

/** 搜索或切换分类：回到第一页；页码确实变化时由 filePage 的 watch 统一发起请求 */
function resetFilePageAndLoad() {
  if (!form.value.category) {
    clearFileItems();
    fileTotal.value = 0;
    return;
  }
  if (filePage.value === 1) {
    beginFilesLoading(clearFileItems);
    void loadFiles();
  } else {
    filePage.value = 1;
  }
}

watch(fileKeyword, useDebounceFn(resetFilePageAndLoad, 300));

watch(filePage, () => {
  beginFilesLoading(clearFileItems);
  void loadFiles();
});

function resetForm() {
  form.value = {
    rootId: appStore.activeRootId || roots.value[0]?.id || '',
    category: categoryStore.activeCategory ?? '',
    remark: '',
    requirePassword: false,
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

async function open() {
  resetForm();
  if (roots.value.length === 0) await categoryStore.loadRoots();
  if (!form.value.rootId) form.value.rootId = roots.value[0]?.id ?? '';
  if (form.value.rootId && categories.value.length === 0) {
    await categoryStore.loadCategories(form.value.rootId);
  }
  if (!form.value.category)
    form.value.category = categories.value[0]?.name ?? '';
  createShow.value = true;
  await loadFiles();
}

defineExpose({ open });

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
    resetFilePageAndLoad();
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
      ...new Set([
        ...selectedPaths.value,
        ...fileItems.value.map((f) => f.path),
      ]),
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
  if (
    preset === -1 &&
    (!form.value.customHours || form.value.customHours <= 0)
  ) {
    message.warning('自定义有效期必须大于 0 小时');
    return;
  }
  if (form.value.requirePassword && !form.value.password.trim()) {
    message.warning('已勾选「需要密码」，请填写访问密码');
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
      ...(form.value.maxAccesses
        ? { maxAccesses: form.value.maxAccesses }
        : {}),
      ...(form.value.requirePassword && form.value.password.trim()
        ? { password: form.value.password.trim() }
        : {}),
    });
    createShow.value = false;
    message.success('分享链接已创建');
    emit('created', result);
  } catch (e) {
    message.error(getErrorMessage(e, '创建分享失败'));
  } finally {
    creating.value = false;
  }
}
</script>

<template>
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
            :options="
              categories.map((c) => ({
                label: `${c.name}（${c.fileCount}）`,
                value: c.name,
              }))
            "
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
            <span
              v-if="selectedCount"
              class="text-brand-600 dark:text-brand-400 font-600"
            >
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
            <template #prefix
              ><NIcon :size="13"><SearchOutline /></NIcon
            ></template>
          </NInput>
          <NButton size="tiny" quaternary @click="toggleAllOnPage">
            {{ allOnPageSelected ? '取消本页' : '全选本页' }}
          </NButton>
        </div>

        <div
          class="relative rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/40 dark:bg-white/4 min-h-40 max-h-64 overflow-hidden"
        >
          <div class="max-h-64 overflow-y-auto">
            <div v-if="filesError" class="p-4 text-12px text-ink-sub">
              {{ filesError }}
              <NButton size="tiny" class="ml-2" @click="loadFiles"
                >重试</NButton
              >
            </div>
            <div
              v-else-if="!filesLoading && fileItems.length === 0"
              class="p-6 text-center text-12px text-ink-sub"
            >
              当前分类没有文件，请先在文件库上传
            </div>
            <div
              v-for="file in fileItems"
              v-else
              :key="file.path"
              role="checkbox"
              :aria-checked="selectedPaths.includes(file.path)"
              tabindex="0"
              class="flex items-center gap-2 px-3 py-2.5 min-h-11 cursor-pointer border-b border-glass-border/50 dark:border-glass-border-dark/50 last:border-b-0 hover:bg-brand-500/6 focus-visible:outline-none focus-visible:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 select-none"
              @click="togglePath(file.path)"
              @keydown.space.prevent="togglePath(file.path)"
              @keydown.enter.prevent="togglePath(file.path)"
            >
              <NCheckbox
                class="pointer-events-none"
                :checked="selectedPaths.includes(file.path)"
                :focusable="false"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span
                  class="block text-12px text-ink truncate"
                  :title="file.path"
                >
                  {{ file.name }}
                </span>
                <span class="block text-11px text-ink-sub">
                  {{ formatBytes(file.size) }} · {{ formatTime(file.mtime) }}
                </span>
              </span>
            </div>
          </div>
          <ListLoading :show="filesLoading" :text="filesLoadingText" />
        </div>

        <div
          v-if="filePages > 1"
          class="flex items-center justify-end gap-2 text-11px text-ink-sub"
        >
          <span>{{ filePage }} / {{ filePages }}</span>
          <NButton
            size="tiny"
            quaternary
            :disabled="filePage <= 1"
            @click="filePage -= 1"
          >
            <template #icon
              ><NIcon><ChevronBackOutline /></NIcon
            ></template>
          </NButton>
          <NButton
            size="tiny"
            quaternary
            :disabled="filePage >= filePages"
            @click="filePage += 1"
          >
            <template #icon
              ><NIcon><ChevronForwardOutline /></NIcon
            ></template>
          </NButton>
        </div>
      </section>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">访问密码</span>
          <NCheckbox v-model:checked="form.requirePassword" size="small">
            需要密码
          </NCheckbox>
          <NInput
            v-if="form.requirePassword"
            v-model:value="form.password"
            size="small"
            type="password"
            show-password-on="click"
            placeholder="请输入访问密码"
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

      <p class="m-0 text-11px text-ink-sub flex items-start gap-1.5">
        <NIcon :size="13" class="mt-0.5 shrink-0"
          ><InformationCircleOutline
        /></NIcon>
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
          @click="submitCreate"
        >
          创建分享
        </NButton>
      </div>
    </template>
  </NModal>
</template>
