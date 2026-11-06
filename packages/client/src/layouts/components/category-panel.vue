<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NDropdown,
  NIcon,
  NInput,
  NModal,
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
} from '@vicons/ionicons5';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import ConfirmModal from '@/components/common/confirm-modal.vue';
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
/** 嵌入侧栏时去掉独立面板的外观，只保留内容与滚动 */
const props = defineProps<{ embedded?: boolean }>();

const route = useRoute();
const router = useRouter();
const message = useMessage();
const appStore = useAppStore();
const categoryStore = useCategoryStore();

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
</script>

<template>
  <section
    class="flex flex-col min-h-0"
    :class="props.embedded ? 'h-full' : 'glass-panel w-60 h-full shrink-0'"
  >
    <header :class="props.embedded ? 'px-2 pt-3 pb-2' : 'px-4 pt-4 pb-3'">
      <div class="flex items-center justify-between mb-3">
        <span
          class="text-ink font-600 tracking-wide"
          :class="props.embedded ? 'text-12px' : 'text-sm'"
          >资源分类</span
        >
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
    </header>

    <nav
      class="flex-1 min-h-0 overflow-y-auto pb-2"
      :class="props.embedded ? 'px-1 scrollbar-hidden' : 'px-2'"
    >
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
              class="w-full flex items-center gap-2.5 h-8 pl-2.5 pr-8 rounded-[10px] border-none bg-transparent cursor-pointer transition-colors text-ink-sub hover:bg-[var(--mat-hover)]"
              :class="{
                'bg-brand-500/12! dark:bg-brand-400/15! text-brand-700 dark:text-brand-300 font-600':
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
      class="border-t border-[var(--mat-line-soft)]"
      :class="props.embedded ? 'px-3 py-2' : 'px-4 py-3'"
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
  </section>
</template>
