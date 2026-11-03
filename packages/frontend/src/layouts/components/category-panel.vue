<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NDropdown,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NSpin,
  NSwitch,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  FolderOpenOutline,
  FolderOutline,
  RefreshOutline,
  SettingsOutline,
  TrashOutline,
  CreateOutline,
} from '@vicons/ionicons5';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import DirectoryPicker from '@/components/common/directory-picker.vue';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';

/**
 * Category Panel（240px 独立玻璃面板）
 *
 * 数据全部来自后端：
 * - 根目录 GET /roots
 * - 分类名 GET /files/:rootId/categories
 * - 分类计数 GET /files/stats/usage
 * - 新建 POST /files/:rootId/categories
 * - 删除 DELETE /files/:rootId/categories/:category（非空需 recursive=true）
 */
const route = useRoute();
const router = useRouter();
const message = useMessage();
const appStore = useAppStore();
const categoryStore = useCategoryStore();

const rootOptions = computed(() =>
  categoryStore.roots.map((root) => ({ label: root.name, value: root.id })),
);
const categories = computed(() =>
  categoryStore.categoriesOf(appStore.activeRootId),
);

onMounted(async () => {
  if (categoryStore.roots.length === 0) await categoryStore.loadRoots();
  await categoryStore.loadCategories(appStore.activeRootId);
});

watch(
  () => appStore.activeRootId,
  (rootId) => {
    categoryStore.setActiveCategory(null);
    void categoryStore.loadCategories(rootId);
  },
);

function onRootChange(rootId: string) {
  appStore.setActiveRoot(rootId);
}

function selectCategory(name: string) {
  categoryStore.setActiveCategory(name);
  if (route.name !== 'files') void router.push({ name: 'files' });
}

// —— 行内操作 ——
const rowMenuOptions = [
  { label: '重命名', key: 'rename' },
  { label: '删除分类', key: 'delete' },
];

const renameShow = ref(false);
const renameTarget = ref('');
const renameValue = ref('');
const renameLoading = ref(false);

function openRename(name: string) {
  renameTarget.value = name;
  renameValue.value = name;
  renameShow.value = true;
}

async function submitRename() {
  const name = renameValue.value.trim();
  if (!name || name === renameTarget.value) return;
  renameLoading.value = true;
  try {
    await categoryStore.rename(appStore.activeRootId, renameTarget.value, name);
    message.success(`分类已重命名为「${name}」`);
    renameShow.value = false;
    if (route.name !== 'files') void router.push({ name: 'files' });
  } catch (e) {
    message.error(e instanceof Error ? e.message : '重命名失败');
  } finally {
    renameLoading.value = false;
  }
}

const deleteShow = ref(false);
const deleteTarget = ref('');
const deleteLoading = ref(false);
const deleteRecursive = ref(false);

function openDelete(name: string) {
  deleteTarget.value = name;
  deleteRecursive.value = false;
  deleteShow.value = true;
}

async function confirmDeleteCategory() {
  const target = deleteTarget.value;
  deleteLoading.value = true;
  try {
    const result = await categoryStore.delete(
      appStore.activeRootId,
      target,
      deleteRecursive.value,
    );
    message.success(
      result.removedEntries > 0
        ? `分类「${target}」已删除，连同 ${result.removedEntries} 项文件`
        : `分类「${target}」已删除`,
    );
    deleteShow.value = false;
  } catch (e) {
    message.error(getErrorMessage(e, '删除分类失败'));
  } finally {
    deleteLoading.value = false;
  }
}

function onRowAction(key: string, name: string) {
  if (key === 'rename') openRename(name);
  else if (key === 'delete') openDelete(name);
}

// —— 新建分类 ——
const createShow = ref(false);
const createValue = ref('');
const createLoading = ref(false);

function openCreate() {
  createValue.value = '';
  createShow.value = true;
}

async function submitCreate() {
  const name = createValue.value.trim();
  if (!name) {
    message.warning('请输入分类名');
    return;
  }
  if (name.includes('/') || name.includes('\\')) {
    message.warning('分类名不能包含路径分隔符');
    return;
  }
  createLoading.value = true;
  try {
    await categoryStore.create(appStore.activeRootId, name);
    message.success(`分类「${name}」已创建`);
    createShow.value = false;
  } catch (e) {
    message.error(getErrorMessage(e, '新建分类失败'));
  } finally {
    createLoading.value = false;
  }
}

// —— 根目录管理 ——
const rootMgrShow = ref(false);
const rootForm = reactive({ id: '', name: '', path: '' });
const rootFormError = ref('');
const rootFormLoading = ref(false);
const rootFormMode = ref<'create' | 'edit'>('create');
const rootEditId = ref('');
const rootDeleteShow = ref(false);
const rootDeleteTarget = ref('');
const rootDeleteLoading = ref(false);

// —— 服务器目录选择 ——
const browseShow = ref(false);
const browseInitialPath = ref('');

function openBrowse() {
  browseInitialPath.value = rootForm.path.trim();
  browseShow.value = true;
}

function onBrowseSelect(path: string) {
  rootForm.path = path;
  rootFormError.value = '';
}

function openRootMgr() {
  openCreateRoot();
  rootMgrShow.value = true;
}

function openCreateRoot() {
  rootFormMode.value = 'create';
  rootEditId.value = '';
  rootForm.id = '';
  rootForm.name = '';
  rootForm.path = '';
  rootFormError.value = '';
}

function openEditRoot(rootId: string) {
  const root = categoryStore.roots.find((r) => r.id === rootId);
  if (!root) return;
  rootFormMode.value = 'edit';
  rootEditId.value = rootId;
  rootForm.id = root.id;
  rootForm.name = root.name;
  rootForm.path = root.path;
  rootFormError.value = '';
}

/** 新建根目录时，名称+路径必填；标识可留空，自动生成合法 ID */
function autoRootId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  if (slug.length >= 2) return slug.slice(0, 31);
  return `root-${Date.now().toString(36)}`;
}

async function submitRoot() {
  const name = rootForm.name.trim();
  const path = rootForm.path.trim();
  const id = rootForm.id.trim() || autoRootId(name || 'root');
  if (!name || !path) {
    rootFormError.value = '名称与路径均为必填';
    return;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,30}$/.test(id)) {
    rootFormError.value =
      '标识需为 2~31 位字母/数字/下划线/连字符，且以字母或数字开头';
    return;
  }
  rootFormLoading.value = true;
  rootFormError.value = '';
  try {
    if (rootFormMode.value === 'create') {
      await categoryStore.addRoot({ id, name, path });
      appStore.setActiveRoot(id);
      await categoryStore.loadCategories(id);
      message.success(`根目录「${name}」已创建`);
    } else {
      await categoryStore.editRoot(rootEditId.value, { name, path });
      message.success(`根目录「${name}」已更新`);
    }
    rootMgrShow.value = false;
  } catch (e) {
    rootFormError.value = getErrorMessage(e, '保存根目录失败');
  } finally {
    rootFormLoading.value = false;
  }
}

function askDeleteRoot(rootId: string) {
  rootDeleteTarget.value = rootId;
  rootDeleteShow.value = true;
}

async function confirmDeleteRoot() {
  const target = rootDeleteTarget.value;
  if (!target) return;
  rootDeleteLoading.value = true;
  try {
    await categoryStore.removeRoot(target);
    message.success('根目录已删除');
    if (appStore.activeRootId === target) {
      const next = categoryStore.roots[0]?.id ?? '';
      appStore.setActiveRoot(next);
    }
    rootDeleteShow.value = false;
  } catch (e) {
    message.error(getErrorMessage(e, '删除根目录失败'));
  } finally {
    rootDeleteLoading.value = false;
  }
}
</script>

<template>
  <section class="glass-panel w-60 h-full flex flex-col shrink-0">
    <header class="px-4 pt-4 pb-3">
      <div class="flex items-center justify-between mb-3">
        <span class="text-ink text-sm font-600 tracking-wide">资源分类</span>
        <div class="flex items-center gap-1">
          <NTooltip placement="bottom" :delay="300">
            <template #trigger>
              <NButton
                size="tiny"
                quaternary
                circle
                :loading="categoryStore.refreshing"
                @click="
                  categoryStore.loadCategories(appStore.activeRootId, {
                    silent: true,
                  })
                "
              >
                <template #icon
                  ><NIcon :size="15"><RefreshOutline /></NIcon
                ></template>
              </NButton>
            </template>
            刷新分类
          </NTooltip>
          <NTooltip placement="bottom" :delay="300">
            <template #trigger>
              <NButton size="tiny" quaternary circle @click="openCreate">
                <template #icon
                  ><NIcon :size="16"><AddOutline /></NIcon
                ></template>
              </NButton>
            </template>
            新建分类
          </NTooltip>
        </div>
      </div>
      <NSelect
        :value="appStore.activeRootId"
        :options="rootOptions"
        size="small"
        :loading="categoryStore.loading && rootOptions.length === 0"
        @update:value="onRootChange"
      />
      <div class="mt-2 flex items-center justify-end">
        <NButton size="tiny" quaternary @click="openRootMgr">
          <template #icon
            ><NIcon :size="14"><SettingsOutline /></NIcon
          ></template>
          管理根目录
        </NButton>
      </div>
    </header>

    <nav class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
      <NSpin :show="categoryStore.loading" size="small">
        <!-- 错误态 -->
        <div v-if="categoryStore.error" class="px-3 py-6 text-center">
          <p class="m-0 text-12px text-ink-sub">{{ categoryStore.error }}</p>
          <NButton
            class="mt-2"
            size="tiny"
            @click="categoryStore.loadCategories(appStore.activeRootId)"
          >
            重试
          </NButton>
        </div>

        <!-- 空态 -->
        <div
          v-else-if="!categoryStore.loading && categories.length === 0"
          class="px-3 py-8 text-center"
        >
          <NIcon :size="26" class="text-ink-sub opacity-60"
            ><FolderOutline
          /></NIcon>
          <p class="m-0 mt-2 text-12px text-ink-sub">该根目录下还没有分类</p>
          <p class="m-0 mt-1 text-11px text-ink-sub">
            点击上方「+」即可新建空分类
          </p>
        </div>

        <ul v-else class="m-0 p-0 list-none flex flex-col gap-1">
          <li
            v-for="item in categories"
            :key="item.name"
            class="group relative"
          >
            <button
              class="w-full flex items-center gap-2.5 pl-3 pr-8 py-2 rounded-xl border-none bg-transparent cursor-pointer transition-all duration-200 text-ink-sub hover:bg-white/60 dark:hover:bg-white/8"
              :class="{
                'bg-white/80! dark:bg-white/10! text-ink dark:text-ink-dark shadow-glass':
                  categoryStore.activeCategory === item.name,
              }"
              @click="selectCategory(item.name)"
            >
              <NIcon :size="17" class="shrink-0 text-brand-500">
                <FolderOpenOutline
                  v-if="categoryStore.activeCategory === item.name"
                />
                <FolderOutline v-else />
              </NIcon>
              <span class="flex-1 min-w-0 truncate text-left text-13px">
                {{ item.name }}
              </span>
              <span
                class="glass-chip px-2 py-0.5 text-11px leading-4 text-ink-sub"
              >
                {{ item.fileCount }}
              </span>
            </button>

            <div
              class="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <NDropdown
                trigger="click"
                :options="rowMenuOptions"
                placement="bottom-end"
                @select="(key: string) => onRowAction(key, item.name)"
              >
                <span
                  class="w-6 h-6 rounded-full flex items-center justify-center text-ink-sub bg-white/70 dark:bg-white/10 cursor-pointer text-12px"
                  @click.stop
                >
                  ⋯
                </span>
              </NDropdown>
            </div>
          </li>
        </ul>
      </NSpin>
    </nav>

    <footer
      class="px-4 py-3 border-t border-glass-border dark:border-glass-border-dark"
    >
      <p class="m-0 text-11px text-ink-sub">
        {{ categories.length }} 个分类 ·
        {{ formatBytes(categories.reduce((s, c) => s + c.totalSize, 0)) }}
      </p>
    </footer>

    <!-- 重命名分类 -->
    <NModal
      v-model:show="renameShow"
      preset="dialog"
      title="重命名分类"
      positive-text="保存"
      negative-text="取消"
      :positive-button-props="{
        loading: renameLoading,
        disabled: !renameValue.trim() || renameValue.trim() === renameTarget,
      }"
      @positive-click="submitRename"
    >
      <NInput
        v-model:value="renameValue"
        class="mt-4"
        maxlength="255"
        placeholder="输入新分类名"
        @keyup.enter="submitRename"
      />
      <p class="m-0 mt-2 text-11px text-ink-sub">
        目录改名后，文件索引与分享链接会在同一事务内迁移
      </p>
    </NModal>

    <!-- 删除分类 -->
    <ConfirmModal
      v-model:show="deleteShow"
      title="删除分类"
      :content="`即将删除分类「${deleteTarget}」。\n默认仅允许删除空分类；若分类内仍有文件，需开启下方选项连同文件一并删除。`"
      positive-text="确认删除"
      :loading="deleteLoading"
      @confirm="confirmDeleteCategory"
    >
      <div class="mt-3 flex items-center gap-2">
        <NSwitch v-model:value="deleteRecursive" size="small" />
        <span class="text-12px text-ink-sub">
          同时删除分类内所有文件（含分享链接，不可恢复）
        </span>
      </div>
    </ConfirmModal>

    <!-- 新建分类 -->
    <NModal
      v-model:show="createShow"
      preset="dialog"
      title="新建分类"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{
        loading: createLoading,
        disabled: !createValue.trim(),
      }"
      @positive-click="submitCreate"
    >
      <NInput
        v-model:value="createValue"
        class="mt-4"
        maxlength="255"
        placeholder="输入分类名"
        @keyup.enter="submitCreate"
      />
      <p class="m-0 mt-2 text-11px text-ink-sub">
        分类名不能包含路径分隔符，且不能与已有分类或默认分类重名
      </p>
    </NModal>

    <!-- 根目录管理 -->
    <NModal
      v-model:show="rootMgrShow"
      preset="card"
      title="管理根目录"
      style="width: 560px"
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2">
          <div
            v-for="root in categoryStore.roots"
            :key="root.id"
            class="glass-panel px-3 py-2.5 flex items-center gap-2"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-13px font-600 text-ink">{{ root.name }}</span>
                <span
                  class="glass-chip px-1.5 py-0.5 text-10px text-ink-sub font-mono"
                >
                  {{ root.id }}
                </span>
              </div>
              <p class="m-0 text-11px text-ink-sub truncate font-mono">
                {{ root.path }}
              </p>
            </div>
            <NButton
              size="tiny"
              quaternary
              circle
              :disabled="root.id === appStore.activeRootId ? false : false"
              @click="openEditRoot(root.id)"
            >
              <template #icon
                ><NIcon :size="14"><CreateOutline /></NIcon
              ></template>
            </NButton>
            <NButton
              size="tiny"
              quaternary
              circle
              @click="askDeleteRoot(root.id)"
            >
              <template #icon
                ><NIcon :size="14"><TrashOutline /></NIcon
              ></template>
            </NButton>
          </div>
        </div>

        <div
          class="border-t border-glass-border dark:border-glass-border-dark pt-3 flex flex-col gap-2"
        >
          <h3 class="m-0 text-12px font-600 text-ink">
            {{ rootFormMode === 'create' ? '新增根目录' : '编辑根目录' }}
          </h3>
          <div class="flex items-center gap-2">
            <label class="text-11px text-ink-sub w-14 shrink-0">
              {{ rootFormMode === 'create' ? '标识' : 'ID' }}
            </label>
            <NInput
              v-model:value="rootForm.id"
              size="small"
              :placeholder="
                rootFormMode === 'create'
                  ? '可留空，按名称自动生成'
                  : '创建后不可修改'
              "
              :disabled="rootFormMode === 'edit'"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-11px text-ink-sub w-14 shrink-0">名称</label>
            <NInput
              v-model:value="rootForm.name"
              size="small"
              placeholder="显示名称"
            />
          </div>
          <div class="flex items-center gap-2">
            <label class="text-11px text-ink-sub w-14 shrink-0">路径</label>
            <NInput
              v-model:value="rootForm.path"
              class="flex-1 min-w-0"
              size="small"
              placeholder="服务器绝对路径"
            />
            <NButton size="small" class="shrink-0" @click="openBrowse">
              <template #icon
                ><NIcon :size="14"><FolderOpenOutline /></NIcon
              ></template>
              浏览
            </NButton>
          </div>
          <p v-if="rootFormError" class="m-0 text-12px text-red-500">
            {{ rootFormError }}
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <NButton size="small" quaternary @click="rootMgrShow = false"
              >关闭</NButton
            >
            <NButton
              size="small"
              type="primary"
              :loading="rootFormLoading"
              @click="submitRoot"
            >
              {{ rootFormMode === 'create' ? '新增' : '保存' }}
            </NButton>
          </div>
        </div>
      </div>
    </NModal>

    <!-- 服务器目录选择 -->
    <DirectoryPicker
      v-model:show="browseShow"
      :initial-path="browseInitialPath"
      @select="onBrowseSelect"
    />

    <!-- 删除根目录 -->
    <ConfirmModal
      v-model:show="rootDeleteShow"
      title="删除根目录"
      :content="`确认删除根目录「${rootDeleteTarget}」？\n仅允许删除空目录：目录内仍有文件或分类时后端会拒绝并说明原因，不会静默删数据。`"
      positive-text="确认删除"
      :loading="rootDeleteLoading"
      @confirm="confirmDeleteRoot"
    />
  </section>
</template>
