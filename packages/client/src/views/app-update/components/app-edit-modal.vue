<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  NButton,
  NDatePicker,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  useMessage,
} from 'naive-ui';
import { updateVersion } from '@/api/app-update';
import type { AppVersionRecord } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';

/** 编辑版本：版本名、更新说明、备注与定时发布；versionCode/安装包不可改 */
const props = defineProps<{
  show: boolean;
  version: AppVersionRecord | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  done: [];
}>();

const message = useMessage();
const savingEdit = ref(false);
const editForm = ref({
  versionName: '',
  updateLog: '',
  remark: '',
  scheduled: false,
  scheduledAt: null as number | null,
  scheduledMode: 'full' as 'full' | 'gray',
  scheduledGrayPercent: 20,
});

watch(
  () => props.show,
  (show) => {
    const version = props.version;
    if (!show || !version) return;
    editForm.value = {
      versionName: version.versionName,
      updateLog: version.updateLog ?? '',
      remark: version.remark ?? '',
      scheduled: version.scheduledPublishAt !== null,
      scheduledAt: version.scheduledPublishAt,
      scheduledMode: version.scheduledPublishMode === 'gray' ? 'gray' : 'full',
      scheduledGrayPercent: version.scheduledGrayPercent || 20,
    };
  },
  { immediate: true },
);

async function submitEdit() {
  const target = props.version;
  if (!target) return;
  if (!editForm.value.versionName.trim()) {
    message.warning('版本名不能为空');
    return;
  }
  if (editForm.value.scheduled) {
    if (!editForm.value.scheduledAt) {
      message.warning('请选择定时发布时间');
      return;
    }
    if (editForm.value.scheduledAt <= Date.now()) {
      message.warning('定时发布时间必须晚于当前时间');
      return;
    }
  }
  savingEdit.value = true;
  try {
    await updateVersion(target.id, {
      versionName: editForm.value.versionName.trim(),
      updateLog: editForm.value.updateLog,
      remark: editForm.value.remark,
      scheduledPublishAt: editForm.value.scheduled
        ? editForm.value.scheduledAt
        : null,
      scheduledPublishMode: editForm.value.scheduledMode,
      scheduledGrayPercent: editForm.value.scheduledGrayPercent,
    });
    message.success('版本信息已更新');
    emit('update:show', false);
    emit('done');
  } catch (e) {
    message.error(getErrorMessage(e, '保存失败'));
  } finally {
    savingEdit.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`编辑 v${version?.versionName ?? ''}`"
    class="w-600px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1">
        <span class="text-12px text-ink-sub"
          >版本名（versionCode 与安装包不可修改）</span
        >
        <NInput v-model:value="editForm.versionName" size="small" />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-12px text-ink-sub">更新说明</span>
        <NInput
          v-model:value="editForm.updateLog"
          type="textarea"
          size="small"
          :rows="3"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-12px text-ink-sub">内部备注</span>
        <NInput
          v-model:value="editForm.remark"
          type="textarea"
          size="small"
          :rows="2"
        />
      </label>

      <div class="flex items-center gap-2">
        <NSwitch v-model:value="editForm.scheduled" size="small" />
        <span class="text-12px text-ink">定时发布</span>
      </div>
      <div
        v-if="editForm.scheduled"
        class="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <label class="flex flex-col gap-1 sm:col-span-2">
          <span class="text-11px text-ink-sub">发布时间</span>
          <NDatePicker
            v-model:value="editForm.scheduledAt"
            type="datetime"
            size="small"
            clearable
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-11px text-ink-sub">模式</span>
          <NRadioGroup v-model:value="editForm.scheduledMode" size="small">
            <NRadioButton value="full">全量</NRadioButton>
            <NRadioButton value="gray">灰度</NRadioButton>
          </NRadioGroup>
        </label>
        <label
          v-if="editForm.scheduledMode === 'gray'"
          class="flex flex-col gap-1"
        >
          <span class="text-11px text-ink-sub">灰度百分比</span>
          <NInputNumber
            v-model:value="editForm.scheduledGrayPercent"
            size="small"
            :min="1"
            :max="99"
          />
        </label>
      </div>
      <p class="m-0 text-11px text-ink-sub">
        仅草稿/已下架版本可编辑，发布中的版本需先下架。
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="savingEdit"
          @click="submitEdit"
          >保存</NButton
        >
      </div>
    </template>
  </NModal>
</template>
