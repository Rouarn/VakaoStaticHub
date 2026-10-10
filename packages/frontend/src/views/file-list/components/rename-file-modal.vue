<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { NModal, NButton, NInput, useMessage } from 'naive-ui';
import { renameFile } from '@/api/files';
import { getErrorMessage } from '@/utils/request';
import { useFileListStore } from '@/stores/modules/file-list';

const props = defineProps<{
  visible: boolean;
  filePath: string;
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

const currentName = computed(
  () => props.filePath.split('/').pop() || props.filePath,
);

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return;
    newName.value = currentName.value;
    await nextTick();
    inputRef.value?.inputElRef?.focus();
    const el = inputRef.value?.inputElRef;
    if (el && typeof el.setSelectionRange === 'function') {
      // 默认选中扩展名之前的部分，隐藏文件（如 .gitignore）则全选
      const dot = currentName.value.lastIndexOf('.');
      const end = dot > 0 ? dot : currentName.value.length;
      el.setSelectionRange(0, end);
    }
  },
);

function close() {
  emit('close');
}

async function handleRename() {
  const target = newName.value.trim();

  if (!target) {
    message.warning('文件名不能为空');
    return;
  }
  if (target.includes('/') || target.includes('\\')) {
    message.warning('文件名不能包含路径分隔符');
    return;
  }
  if (target === currentName.value) {
    close();
    return;
  }

  loading.value = true;
  try {
    await renameFile(
      store.currentRootId,
      store.currentCategory,
      props.filePath,
      target,
    );
    message.success('重命名成功');
    emit('renamed');
    await store.loadFiles();
    close();
  } catch (error) {
    message.error(getErrorMessage(error, '重命名失败'));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.visible"
    preset="card"
    title="重命名"
    :mask-closable="true"
    style="max-width: 420px"
    @update:show="
      (value) => {
        if (!value) close();
      }
    "
  >
    <div class="space-y-3 py-1">
      <div class="text-sm text-gray-500 truncate" :title="props.filePath">
        文件：{{ props.filePath }}
      </div>
      <NInput
        ref="inputRef"
        v-model:value="newName"
        placeholder="请输入新文件名"
        maxlength="255"
        @keydown.enter="handleRename"
      />
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
