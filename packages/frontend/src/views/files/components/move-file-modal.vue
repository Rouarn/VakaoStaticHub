<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NModal, NSelect } from 'naive-ui';
import type { CategoryEntry } from '@/stores/modules/category';

/**
 * 批量移动文件到其他分类
 * 目标分类只允许选择已存在目录（后端 batch-move 目标目录不存在会报错）
 */
const props = defineProps<{
  show: boolean;
  categories: CategoryEntry[];
  currentCategory: string;
  count: number;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  submit: [targetCategory: string];
}>();

const target = ref<string | null>(null);

watch(
  () => props.show,
  (show) => {
    if (show) target.value = null;
  },
);

const options = computed(() =>
  props.categories
    .filter((c) => c.name !== props.currentCategory)
    .map((c) => ({ label: c.name, value: c.name })),
);
</script>

<template>
  <NModal
    :show="show"
    preset="dialog"
    title="移动到其他分类"
    positive-text="移动"
    negative-text="取消"
    :positive-button-props="{ loading: loading, disabled: !target }"
    @update:show="emit('update:show', $event)"
    @positive-click="target && emit('submit', target)"
  >
    <p class="m-0 mb-3 text-13px text-ink-sub">
      将 {{ count }} 个文件从「{{ currentCategory }}」移动到：
    </p>
    <NSelect
      v-model:value="target"
      :options="options"
      filterable
      placeholder="选择目标分类"
    />
    <p v-if="options.length === 0" class="m-0 mt-2 text-12px text-ink-sub">
      当前分类之外没有其他分类，请先上传文件到新分类
    </p>
  </NModal>
</template>
