<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { NButton, NIcon, NInput, NModal, useMessage } from 'naive-ui';
import {
  AddCircleOutline,
  CheckmarkCircleOutline,
  CreateOutline,
  FolderOpenOutline,
  FolderOutline,
  ServerOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import DirectoryPicker from '@/components/common/directory-picker.vue';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import { getErrorMessage } from '@/utils/http';

/**
 * 根目录管理弹窗：上方新增/编辑表单 + 下方已配置目录列表
 * 入口在文件库页「管理根目录」，每次打开时重置为新增模式
 */
const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();

const showProxy = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
});

const message = useMessage();
const appStore = useAppStore();
const categoryStore = useCategoryStore();

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
    showProxy.value = false;
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

watch(
  () => props.show,
  (v) => {
    if (v) openCreateRoot();
  },
);
</script>

<template>
  <!-- 根目录管理：上方新增/编辑表单 + 下方已配置目录列表 -->
  <NModal
    v-model:show="showProxy"
    preset="card"
    title="多资源目录管理"
    style="width: 680px; max-width: calc(100vw - 32px)"
  >
    <div class="max-h-[70vh] min-h-0 flex flex-col gap-4">
      <!-- 新增 / 编辑 -->
      <section
        class="shrink-0 rounded-2xl border border-glass-border dark:border-glass-border-dark bg-white/55 dark:bg-white/5 p-4"
      >
        <div class="flex items-center gap-2 mb-3">
          <NIcon :size="16" class="text-brand-500">
            <AddCircleOutline />
          </NIcon>
          <h3 class="m-0 text-14px font-600 text-ink">
            {{ rootFormMode === 'create' ? '添加新资源目录' : '编辑资源目录' }}
          </h3>
          <span
            v-if="rootFormMode === 'edit'"
            class="min-w-0 truncate text-11px text-ink-sub font-mono"
          >
            ID：{{ rootForm.id }}
          </span>
          <NButton
            v-if="rootFormMode === 'edit'"
            size="tiny"
            quaternary
            class="ml-auto"
            @click="openCreateRoot"
          >
            取消编辑
          </NButton>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex flex-col gap-1.5 min-w-0">
            <span class="text-11px text-ink-sub">唯一标识</span>
            <NInput
              v-model:value="rootForm.id"
              size="small"
              placeholder="如：archive（留空则按名称生成）"
              :disabled="rootFormMode === 'edit'"
            />
          </label>
          <label class="flex flex-col gap-1.5 min-w-0">
            <span class="text-11px text-ink-sub">显示名称</span>
            <NInput
              v-model:value="rootForm.name"
              size="small"
              placeholder="如：归档数据"
            />
          </label>
        </div>

        <label class="flex flex-col gap-1.5 mt-3">
          <span class="text-11px text-ink-sub">本地路径</span>
          <div class="flex items-center gap-2">
            <NInput
              v-model:value="rootForm.path"
              class="flex-1 min-w-0"
              size="small"
              placeholder="服务器绝对路径"
            />
            <NButton size="small" class="shrink-0" @click="openBrowse">
              <template #icon>
                <NIcon :size="14"><FolderOpenOutline /></NIcon>
              </template>
              浏览
            </NButton>
          </div>
        </label>

        <p v-if="rootFormError" class="m-0 mt-2 text-12px text-red-500">
          {{ rootFormError }}
        </p>

        <div class="flex justify-end mt-3">
          <NButton
            size="small"
            type="primary"
            :loading="rootFormLoading"
            @click="submitRoot"
          >
            <template #icon>
              <NIcon :size="14"><CheckmarkCircleOutline /></NIcon>
            </template>
            {{ rootFormMode === 'create' ? '确认添加' : '保存修改' }}
          </NButton>
        </div>
      </section>

      <div
        class="shrink-0 border-t border-glass-border dark:border-glass-border-dark"
      />

      <!-- 已配置目录：列表区域内部滚动，滚动条隐藏 -->
      <section class="flex flex-col flex-1 min-h-0">
        <div class="flex items-center gap-2 mb-1 shrink-0">
          <NIcon :size="16" class="text-brand-500">
            <ServerOutline />
          </NIcon>
          <h3 class="m-0 text-14px font-600 text-ink">已配置目录</h3>
          <span class="ml-auto text-11px text-ink-sub">
            共 {{ categoryStore.roots.length }} 个
          </span>
        </div>

        <ul
          class="m-0 p-0 list-none flex-1 min-h-0 overflow-y-auto scrollbar-hidden"
        >
          <li
            v-for="root in categoryStore.roots"
            :key="root.id"
            class="flex items-center gap-3 py-2.5 border-b border-glass-border/60 dark:border-glass-border-dark/60 last:border-b-0"
          >
            <div
              class="w-9 h-9 rounded-xl bg-brand-500/10 text-brand-500 flex items-center justify-center shrink-0"
            >
              <NIcon :size="17"><FolderOutline /></NIcon>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-13px font-600 text-ink truncate">
                  {{ root.name }}
                </span>
                <span
                  class="glass-chip px-1.5 py-0.5 text-10px text-ink-sub font-mono"
                >
                  ID: {{ root.id }}
                </span>
                <span
                  v-if="appStore.activeRootId === root.id"
                  class="text-10px text-brand-500 bg-brand-500/10 px-1.5 py-0.5 rounded-full"
                >
                  当前
                </span>
              </div>
              <p class="m-0 mt-1 text-11px text-ink-sub font-mono truncate">
                {{ root.path }}
              </p>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <NButton
                size="tiny"
                quaternary
                circle
                title="编辑"
                @click="openEditRoot(root.id)"
              >
                <template #icon>
                  <NIcon :size="14"><CreateOutline /></NIcon>
                </template>
              </NButton>
              <NButton
                size="tiny"
                quaternary
                circle
                title="删除"
                @click="askDeleteRoot(root.id)"
              >
                <template #icon>
                  <NIcon :size="14"><TrashOutline /></NIcon>
                </template>
              </NButton>
            </div>
          </li>
        </ul>
      </section>
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
</template>
