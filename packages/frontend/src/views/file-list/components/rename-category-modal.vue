<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { NModal, NButton, NInput, useMessage } from 'naive-ui';
import { getErrorMessage } from '@/utils/request';
import { useFileListStore } from '@/stores/modules/file-list';

const props = defineProps<{
  visible: boolean;
  category: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'renamed'): void;
}>();

const message = useMessage();
const store = useFileListStore();

const newName = ref('');
const loading = ref(false);
const inputRef = ref<{ inputElRef?: HTMLInputElement } | null>(null);

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    newName.value = props.category;
    await nextTick();
    inputRef.value?.inputElRef?.focus();
    inputRef.value?.inputElRef?.select();
  },
);

function close() {
  emit('close');
}

async function handleRename() {
  const target = newName.value.trim();

  if (!target) {
    message.warning('分类名不能为空');
    return;
  }
  if (target.includes('/') || target.includes('\\')) {
    message.warning('分类名不能包含路径分隔符');
    return;
  }
  if (target === props.category) {
    close();
    return;
  }

  loading.value = true;
  try {
    await store.handleRenameCategory(target);
    message.success('分类重命名成功');
    emit('renamed');
    close();
  } catch (error) {
    message.error(getErrorMessage(error, '分类重命名失败'));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.visible"
    preset="card"
    title="重命名分类"
    :mask-closable="true"
    style="max-width: 420px"
    @update:show="
      (value) => {
        if (!value) close();
      }
    "
  >
    <div class="space-y-3 py-1">
      <div class="text-sm text-gray-500 truncate">
        分类：{{ props.category }}
      </div>
      <NInput
        ref="inputRef"
        v-model:value="newName"
        placeholder="请输入新分类名"
        maxlength="255"
        @keydown.enter="handleRename"
      />
      <p class="text-xs text-gray-400">
        目录将整体改名，分类内文件与已有分享链接会自动迁移，不影响访问。
      </p>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton @click="close">取消</NButton>
        <NButton type="primary" :loading="loading" @click="handleRename">
          确定
        </NButton>
      </div>
    </template>
  </NModal>
</template>
