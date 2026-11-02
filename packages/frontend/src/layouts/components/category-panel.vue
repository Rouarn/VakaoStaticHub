<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NDropdown,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NSpin,
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
import { formatBytes } from '@/utils/file-types';

/**
 * Category Panel（240px 独立玻璃面板）
 *
 * 数据全部来自后端：
 * - 根目录 GET /roots
 * - 分类名 GET /files/:rootId/categories
 * - 分类计数 GET /files/stats/usage
 *
 * 后端没有「新建空分类 / 删除空分类」接口：
 * 新建通过上传文件时输入新分类名隐式创建（上传面板已支持），
 * 删除在该面板中如实提示不可用，不做假成功。
 */
const route = useRoute();
const router = useRouter();
const message = useMessage();
const appStore = useAppStore();
const categoryStore = useCategoryStore();

const rootOptions = computed(() =>
  categoryStore.roots.map((root) => ({ label: root.name, value: root.id })),
);
const categories = computed(() => categoryStore.categoriesOf(appStore.activeRootId));

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

function openDelete(name: string) {
  deleteTarget.value = name;
  deleteShow.value = true;
}

/** 后端无删除接口：确认后给出如实提示，不伪造成功 */
function confirmDeleteCategory() {
  deleteLoading.value = true;
  try {
    categoryStore.delete();
  } catch (e) {
    message.warning(e instanceof Error ? e.message : '该操作暂不可用');
  } finally {
    deleteLoading.value = false;
    deleteShow.value = false;
  }
}

function onRowAction(key: string, name: string) {
  if (key === 'rename') openRename(name);
  else if (key === 'delete') openDelete(name);
}

// —— 新建分类说明 ——
const createShow = ref(false);

function goUpload() {
  createShow.value = false;
  if (route.name !== 'files') void router.push({ name: 'files' });
  message.info('在文件库点击「上传文件」，在目标分类处直接输入新名称即可创建');
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
                @click="categoryStore.loadCategories(appStore.activeRootId, { silent: true })"
              >
                <template #icon><NIcon :size="15"><RefreshOutline /></NIcon></template>
              </NButton>
            </template>
            刷新分类
          </NTooltip>
          <NTooltip placement="bottom" :delay="300">
            <template #trigger>
              <NButton size="tiny" quaternary circle @click="createShow = true">
                <template #icon><NIcon :size="16"><AddOutline /></NIcon></template>
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
          <NIcon :size="26" class="text-ink-sub opacity-60"><FolderOutline /></NIcon>
          <p class="m-0 mt-2 text-12px text-ink-sub">该根目录下还没有分类</p>
          <p class="m-0 mt-1 text-11px text-ink-sub">上传文件时输入新分类名即可创建</p>
        </div>

        <ul v-else class="m-0 p-0 list-none flex flex-col gap-1">
          <li v-for="item in categories" :key="item.name" class="group relative">
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-none bg-transparent cursor-pointer transition-all duration-200 text-ink-sub hover:bg-white/60 dark:hover:bg-white/8"
              :class="{
                'bg-white/80! dark:bg-white/10! text-ink dark:text-ink-dark shadow-glass':
                  categoryStore.activeCategory === item.name,
              }"
              @click="selectCategory(item.name)"
            >
              <NIcon :size="17" class="shrink-0 text-brand-500">
                <FolderOpenOutline v-if="categoryStore.activeCategory === item.name" />
                <FolderOutline v-else />
              </NIcon>
              <span class="flex-1 min-w-0 truncate text-left text-13px">
                {{ item.name }}
              </span>
              <span class="glass-chip px-2 py-0.5 text-11px leading-4 text-ink-sub">
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

    <footer class="px-4 py-3 border-t border-glass-border dark:border-glass-border-dark">
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

    <!-- 删除分类（后端能力缺失，如实提示） -->
    <ConfirmModal
      v-model:show="deleteShow"
      title="删除分类"
      :content="`即将删除分类「${deleteTarget}」。\n注意：后端未提供删除分类接口 —— 分类目录随上传隐式创建，服务端也没有删除空目录的 API。确认后将提示具体原因，不会伪造删除成功。`"
      positive-text="我已知晓"
      :loading="deleteLoading"
      @confirm="confirmDeleteCategory"
    />

    <!-- 新建分类说明 -->
    <NModal
      v-model:show="createShow"
      preset="dialog"
      title="新建分类"
      positive-text="去上传"
      negative-text="知道了"
      @positive-click="goUpload"
      @negative-click="createShow = false"
    >
      <p class="m-0 text-13px text-ink-sub leading-relaxed">
        静态资源服务以「上传文件时所在的分类目录」为准创建分类：
        在文件库点击「上传文件」，把目标分类改成新名称，上传成功该目录即被创建。
        当前后端未提供直接创建空目录的接口。
      </p>
    </NModal>
  </section>
</template>
