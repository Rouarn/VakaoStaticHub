<script setup lang="ts">
import { ref, watch } from 'vue';
import { NInput, NModal } from 'naive-ui';
import { getExtension } from '@/utils/file-types';

/**
 * 文件重命名弹窗：只允许改 basename，扩展名变化时给出提示但不禁用
 * （后端 RenameFileDto 明确禁止路径分隔符）
 */
const props = defineProps<{
  show: boolean;
  currentName: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  submit: [newName: string];
}>();

const value = ref(props.currentName);

watch(
  () => [props.show, props.currentName] as const,
  ([show]) => {
    if (show) value.value = props.currentName;
  },
  { immediate: true },
);

function submit() {
  const name = value.value.trim();
  if (!name || name === props.currentName) return;
  emit('submit', name);
}

const extChanged = () => {
  const [oldBase, ...oldRest] = props.currentName.split('.');
  const [newBase, ...newRest] = value.value.split('.');
  return oldBase !== newBase || oldRest.join('.') !== newRest.join('.');
};
const warnsInvalid = () => /[\\/]/.test(value.value);
const showExtWarn = () => {
  const oldExt = getExtension(props.currentName);
  const newExt = getExtension(value.value);
  return Boolean(oldExt || newExt) && oldExt !== newExt && extChanged();
};
</script>

<template>
  <NModal
    :show="show"
    preset="dialog"
    title="重命名文件"
    positive-text="保存"
    negative-text="取消"
    :positive-button-props="{
      loading: loading,
      disabled: !value.trim() || warnsInvalid(),
    }"
    @update:show="emit('update:show', $event)"
    @positive-click="submit"
  >
    <NInput
      v-model:value="value"
      class="mt-4"
      placeholder="输入新文件名"
      maxlength="255"
      @keyup.enter="submit"
    />
    <p v-if="warnsInvalid()" class="m-0 mt-2 text-12px text-red-500">
      文件名不能包含路径分隔符
    </p>
    <p v-else-if="showExtWarn()" class="m-0 mt-2 text-12px text-ink-sub">
      修改扩展名可能影响文件预览方式
    </p>
  </NModal>
</template>
