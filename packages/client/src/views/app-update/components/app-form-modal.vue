<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NInput, NModal, useMessage } from 'naive-ui';
import { createApp, renameApp } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';

/** 新建/重命名应用：appKey 同时是存储目录名，重命名会迁移全部版本 */
const props = defineProps<{
  show: boolean;
  mode: 'create' | 'rename' | null;
  activeApp: string;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  saved: [string];
}>();

const message = useMessage();
const appForm = ref({ appKey: '' });
const appSaving = ref(false);

watch(
  () => props.show,
  (show) => {
    if (!show) return;
    appForm.value = {
      appKey: props.mode === 'rename' ? props.activeApp : '',
    };
  },
);

async function submitApp() {
  const value = appForm.value.appKey.trim();
  if (!value) {
    message.warning('应用标识不能为空');
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    message.warning('应用标识只能包含字母、数字、下划线与连字符');
    return;
  }
  appSaving.value = true;
  try {
    if (props.mode === 'create') {
      await createApp(value);
      message.success(`应用 ${value} 已创建`);
    } else {
      await renameApp(props.activeApp, value);
      message.success(`应用已重命名为 ${value}`);
    }
    emit('update:show', false);
    emit('saved', value);
  } catch (e) {
    message.error(getErrorMessage(e, '应用操作失败'));
  } finally {
    appSaving.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="mode === 'create' ? '新建应用' : '重命名应用'"
    class="w-460px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-2">
      <label class="flex flex-col gap-1">
        <span class="text-12px text-ink-sub">应用标识（appKey）</span>
        <NInput
          v-model:value="appForm.appKey"
          size="small"
          placeholder="如 xiaolv，仅字母/数字/下划线/连字符"
        />
      </label>
      <p class="m-0 text-11px text-ink-sub">
        应用标识同时是 software-update
        根下的目录名；重命名会迁移全部版本与事件记录。
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="appSaving"
          @click="submitApp"
          >保存</NButton
        >
      </div>
    </template>
  </NModal>
</template>
