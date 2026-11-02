<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NSelect,
  NButton,
  NIcon,
  NTooltip,
  NModal,
  NInput,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  FolderOutline,
  FolderOpenOutline,
} from '@vicons/ionicons5';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';

/**
 * Category Panel（240px 独立玻璃面板）
 *
 * 只承载用户动态资源分类：顶部根目录切换 + 新建分类入口，
 * 分类列表独立滚动（overflow-y: auto），不随主内容滚动。
 * 数据源本轮为本地 mock（stores/modules/category.ts），结构已按接口预留。
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

function onRootChange(rootId: string) {
  appStore.setActiveRoot(rootId);
  categoryStore.setActiveCategory(null);
}

function selectCategory(name: string) {
  categoryStore.setActiveCategory(name);
  // 点击分类即进入文件库语境
  if (route.name !== 'files') {
    void router.push({ name: 'files' });
  }
}

// —— 新建分类（mock，下一轮对接后端） ——
const showCreateModal = ref(false);
const newCategoryName = ref('');

function submitCreate() {
  const name = newCategoryName.value.trim();
  if (!name) return;
  const ok = categoryStore.addCategory(appStore.activeRootId, name);
  if (ok) {
    message.success(`分类「${name}」已创建（mock）`);
    categoryStore.setActiveCategory(name);
    showCreateModal.value = false;
    newCategoryName.value = '';
  } else {
    message.warning(`分类「${name}」已存在`);
  }
}
</script>

<template>
  <section class="glass-panel w-60 h-full flex flex-col shrink-0">
    <!-- 顶部：标题 + 根目录切换 -->
    <header class="px-4 pt-4 pb-3">
      <div class="flex items-center justify-between mb-3">
        <span class="text-ink text-sm font-600 tracking-wide">资源分类</span>
        <NTooltip placement="bottom" :delay="300">
          <template #trigger>
            <NButton
              size="tiny"
              quaternary
              circle
              @click="showCreateModal = true"
            >
              <template #icon>
                <NIcon :size="16"><AddOutline /></NIcon>
              </template>
            </NButton>
          </template>
          新建分类
        </NTooltip>
      </div>
      <NSelect
        :value="appStore.activeRootId"
        :options="rootOptions"
        size="small"
        @update:value="onRootChange"
      />
    </header>

    <!-- 分类列表（独立滚动） -->
    <nav class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
      <ul class="m-0 p-0 list-none flex flex-col gap-1">
        <li v-for="item in categories" :key="item.name">
          <button
            class="group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-none bg-transparent cursor-pointer transition-all duration-200 text-ink-sub hover:bg-white/60 dark:hover:bg-white/8"
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
            <span
              class="glass-chip px-2 py-0.5 text-11px leading-4 text-ink-sub"
            >
              {{ item.count }}
            </span>
          </button>
        </li>
      </ul>
    </nav>

    <!-- 底部：统计摘要（mock） -->
    <footer
      class="px-4 py-3 border-t border-glass-border dark:border-glass-border-dark"
    >
      <p class="m-0 text-11px text-ink-sub">
        {{ categories.length }} 个分类 · 数据为本地 mock
      </p>
    </footer>

    <!-- 新建分类弹窗 -->
    <NModal
      v-model:show="showCreateModal"
      preset="dialog"
      title="新建分类"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ disabled: !newCategoryName.trim() }"
      @positive-click="submitCreate"
    >
      <NInput
        v-model:value="newCategoryName"
        class="mt-4"
        placeholder="输入分类名称"
        maxlength="64"
        show-count
        @keyup.enter="submitCreate"
      />
    </NModal>
  </section>
</template>
