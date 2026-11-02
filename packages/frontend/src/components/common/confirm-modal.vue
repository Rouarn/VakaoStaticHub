<script setup lang="ts">
import { NModal } from 'naive-ui';

/**
 * 通用二次确认弹窗：删除等不可逆操作统一走这里，
 * 确认按钮用 error 类型以示风险，避免各处自建确认样式。
 */
defineProps<{
  show: boolean;
  title: string;
  content: string;
  positiveText?: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  confirm: [];
}>();
</script>

<template>
  <NModal
    :show="show"
    preset="dialog"
    type="warning"
    :title="title"
    :positive-text="positiveText ?? '确认删除'"
    negative-text="取消"
    :positive-button-props="{ type: 'error', loading: loading }"
    @update:show="emit('update:show', $event)"
    @positive-click="emit('confirm')"
  >
    <p class="m-0 text-13px text-ink-sub whitespace-pre-line">{{ content }}</p>
    <slot />
  </NModal>
</template>
