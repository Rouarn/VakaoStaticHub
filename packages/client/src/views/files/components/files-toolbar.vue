<script setup lang="ts">
import { NButton, NIcon, NInput, NSelect } from 'naive-ui';
import {
  GridOutline,
  ListOutline,
  SearchOutline,
  ServerOutline,
  SettingsOutline,
  ShareSocialOutline,
  SwapHorizontalOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { CategoryEntry } from '@/stores/modules/category';

/** 文件库工具栏：根目录/分类切换、搜索排序、视图切换与批量操作条 */
defineProps<{
  rootId: string;
  rootOptions: { label: string; value: string }[];
  categories: CategoryEntry[];
  category: string;
  q: string;
  sort: 'name' | 'size' | 'mtime';
  order: 'asc' | 'desc';
  viewMode: 'grid' | 'list';
  selectedCount: number;
  allSelected: boolean;
}>();

const emit = defineEmits<{
  'update:q': [string];
  'update:sort': ['name' | 'size' | 'mtime'];
  'update:view-mode': ['grid' | 'list'];
  'root-change': [string];
  'select-category': [string];
  'manage-category': [];
  'manage-root': [];
  'toggle-order': [];
  'select-all': [];
  'batch-move': [];
  'batch-share': [];
  'batch-delete': [];
  'clear-selection': [];
}>();

const sortOptions = [
  { label: '修改时间', value: 'mtime' },
  { label: '名称', value: 'name' },
  { label: '大小', value: 'size' },
];
</script>

<template>
  <!-- 分类 chips（原分类面板的入口迁移到页内） -->
  <div
    class="flex flex-nowrap sm:flex-wrap items-center gap-2 overflow-x-auto scrollbar-hidden pb-1"
  >
    <NSelect
      :value="rootId"
      :options="rootOptions"
      size="small"
      class="w-36 sm:w-40 shrink-0"
      @update:value="emit('root-change', $event)"
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
      @click="emit('select-category', c.name)"
    >
      {{ c.name }}
      <span class="tabular-nums opacity-70">{{ c.fileCount }}</span>
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap h-7 px-3 rounded-full border border-dashed border-[var(--mat-line)] bg-transparent text-12px text-ink-sub cursor-pointer transition-colors hover:text-ink"
      @click="emit('manage-category')"
    >
      + 新建分类
    </button>
    <button
      type="button"
      class="ml-auto shrink-0 h-7 px-3 rounded-full border border-solid border-[var(--mat-line)] bg-[var(--mat-chip)] text-12px text-ink-sub cursor-pointer transition-colors hover:text-ink flex items-center gap-1.5"
      @click="emit('manage-category')"
    >
      <NIcon :size="13"><SettingsOutline /></NIcon>
      管理分类
    </button>
    <button
      type="button"
      class="shrink-0 h-7 px-3 rounded-full border border-solid border-[var(--mat-line)] bg-[var(--mat-chip)] text-12px text-ink-sub cursor-pointer transition-colors hover:text-ink flex items-center gap-1.5"
      @click="emit('manage-root')"
    >
      <NIcon :size="13"><ServerOutline /></NIcon>
      管理根目录
    </button>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <NInput
      :value="q"
      size="small"
      clearable
      placeholder="搜索文件名 / 路径"
      class="w-full! sm:w-64!"
      @update:value="emit('update:q', $event)"
    >
      <template #prefix>
        <NIcon :size="15"><SearchOutline /></NIcon>
      </template>
    </NInput>

    <NSelect
      :value="sort"
      :options="sortOptions"
      size="small"
      class="w-32"
      @update:value="emit('update:sort', $event)"
    />
    <NButton
      size="small"
      quaternary
      circle
      :title="order === 'asc' ? '升序' : '降序'"
      @click="emit('toggle-order')"
    >
      {{ order === 'asc' ? '↑' : '↓' }}
    </NButton>

    <div class="ml-auto flex items-center gap-1">
      <NButton
        size="small"
        circle
        quaternary
        :type="viewMode === 'grid' ? 'primary' : 'default'"
        @click="emit('update:view-mode', 'grid')"
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
        @click="emit('update:view-mode', 'list')"
      >
        <template #icon
          ><NIcon><ListOutline /></NIcon>
        </template>
      </NButton>
    </div>
  </div>

  <!-- 批量操作条 -->
  <div
    v-if="selectedCount > 0"
    class="glass-chip self-start px-3 py-2 flex items-center gap-3"
  >
    <span class="text-12px text-ink">已选 {{ selectedCount }} 项</span>
    <NButton size="tiny" quaternary @click="emit('select-all')">
      {{ allSelected ? '取消全选' : '全选本页' }}
    </NButton>
    <NButton size="tiny" quaternary @click="emit('batch-move')">
      <template #icon
        ><NIcon :size="14"><SwapHorizontalOutline /></NIcon
      ></template>
      移动
    </NButton>
    <NButton size="tiny" quaternary @click="emit('batch-share')">
      <template #icon
        ><NIcon :size="14"><ShareSocialOutline /></NIcon
      ></template>
      创建分享（{{ selectedCount }} 个文件）
    </NButton>
    <NButton size="tiny" quaternary type="error" @click="emit('batch-delete')">
      <template #icon
        ><NIcon :size="14"><TrashOutline /></NIcon
      ></template>
      删除
    </NButton>
    <NButton size="tiny" quaternary @click="emit('clear-selection')"
      >取消</NButton
    >
  </div>
</template>
