<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  NModal,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NButton,
  NUpload,
  NProgress,
  NDatePicker,
  NSelect,
  NSwitch,
  useMessage,
  type UploadFileInfo,
} from 'naive-ui';
import { createVersion } from '@/api/app-update';
import { getErrorMessage } from '@/utils/request';
import { formatSize } from '@/utils/format';
import { RequestError } from '@vakao-ui/axios';

const props = defineProps<{ show: boolean; appKey: string }>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'saved'): void;
}>();

const message = useMessage();

const formRef = ref();
const submitting = ref(false);
const progress = ref(0);
const apkFile = ref<File | null>(null);

const form = ref({
  versionName: '',
  versionCode: null as number | null,
  updateLog: '',
  remark: '',
});

const enableScheduledPublish = ref(false);
const scheduledPublishAt = ref<number | null>(null);
const scheduledPublishMode = ref<'full' | 'gray'>('full');
const scheduledGrayPercent = ref<number | null>(5);

const scheduledGrayOptions = Array.from({ length: 99 }, (_, i) => ({
  label: `${i + 1}%`,
  value: i + 1,
}));

watch(
  () => props.show,
  (show) => {
    if (show) {
      apkFile.value = null;
      progress.value = 0;
      form.value = {
        versionName: '',
        versionCode: null,
        updateLog: '',
        remark: '',
      };
      enableScheduledPublish.value = false;
      scheduledPublishAt.value = null;
      scheduledPublishMode.value = 'full';
      scheduledGrayPercent.value = 5;
    }
  },
);

const rules = {
  versionName: {
    required: true,
    message: '请输入版本名，如 1.0.1',
    trigger: 'blur',
  },
  versionCode: {
    type: 'number' as const,
    required: true,
    message: '请输入整数版本号',
    trigger: 'blur',
  },
};

const fileList = computed(() =>
  apkFile.value
    ? [
        {
          id: 'apk',
          name: apkFile.value.name,
          status: 'finished',
        } as UploadFileInfo,
      ]
    : [],
);

function handleFileChange(options: { fileList: UploadFileInfo[] }) {
  const item = options.fileList[options.fileList.length - 1];
  apkFile.value = item?.file ?? null;
}

function handleRemove() {
  apkFile.value = null;
}

async function handleSubmit() {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }
  if (!apkFile.value) {
    message.error('请选择 APK 安装包');
    return;
  }
  if (!apkFile.value.name.toLowerCase().endsWith('.apk')) {
    message.error('仅支持 .apk 文件');
    return;
  }
  if (enableScheduledPublish.value) {
    if (!scheduledPublishAt.value) {
      message.error('请选择定时发布时间');
      return;
    }
    if (scheduledPublishAt.value <= Date.now()) {
      message.error('定时发布时间必须晚于当前时间');
      return;
    }
    if (scheduledPublishMode.value === 'gray' && !scheduledGrayPercent.value) {
      message.error('请选择定时灰度发布的百分比');
      return;
    }
  }

  submitting.value = true;
  progress.value = 0;
  try {
    await createVersion(
      {
        file: apkFile.value,
        appKey: props.appKey,
        versionName: form.value.versionName.trim(),
        versionCode: form.value.versionCode!,
        updateLog: form.value.updateLog.trim() || undefined,
        remark: form.value.remark.trim() || undefined,
        scheduledPublishAt: enableScheduledPublish.value
          ? scheduledPublishAt.value!
          : undefined,
        scheduledPublishMode: enableScheduledPublish.value
          ? scheduledPublishMode.value
          : undefined,
        scheduledGrayPercent:
          enableScheduledPublish.value && scheduledPublishMode.value === 'gray'
            ? scheduledGrayPercent.value!
            : undefined,
      },
      (e) => {
        if (e.total) progress.value = (e.loaded / e.total) * 100;
      },
    );
    message.success('上传成功，已创建草稿版本');
    emit('saved');
    handleClose();
  } catch (err) {
    message.error(
      err instanceof RequestError && err.type === 'http' && err.code === 413
        ? '文件过大'
        : getErrorMessage(err, '上传失败'),
    );
  } finally {
    submitting.value = false;
  }
}

function handleClose() {
  emit('update:show', false);
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :title="`上传新版本 · ${props.appKey}`"
    class="w-[560px]"
    :mask-closable="!submitting"
    @update:show="(v: boolean) => !v && handleClose()"
  >
    <NForm
      ref="formRef"
      :model="form"
      :rules="rules"
      label-placement="left"
      label-width="90"
    >
      <NFormItem label="APK 文件" required>
        <div class="w-full">
          <NUpload
            :max-count="1"
            accept=".apk"
            :default-upload="false"
            :file-list="fileList"
            :disabled="submitting"
            @change="handleFileChange"
            @remove="handleRemove"
          >
            <NButton size="small" :disabled="submitting"
              >选择 .apk 文件</NButton
            >
          </NUpload>
          <span v-if="apkFile" class="text-xs text-gray-400">
            {{ formatSize(apkFile.size) }}
          </span>
        </div>
      </NFormItem>
      <NFormItem label="版本名" path="versionName">
        <NInput
          v-model:value="form.versionName"
          placeholder="如 1.0.1"
          :disabled="submitting"
        />
      </NFormItem>
      <NFormItem label="版本号" path="versionCode">
        <NInputNumber
          v-model:value="form.versionCode"
          class="w-full"
          :min="1"
          :precision="0"
          placeholder="整数，必须大于该应用线上全量版本"
          :disabled="submitting"
        />
      </NFormItem>
      <NFormItem label="更新说明">
        <NInput
          v-model:value="form.updateLog"
          type="textarea"
          :rows="4"
          placeholder="每行一条更新内容，客户端原样展示"
          :disabled="submitting"
        />
      </NFormItem>
      <NFormItem label="备注">
        <NInput
          v-model:value="form.remark"
          placeholder="内部备注（可选）"
          :disabled="submitting"
        />
      </NFormItem>

      <NFormItem label="定时发布">
        <div class="flex flex-col gap-2 w-full">
          <div class="flex items-center gap-2">
            <NSwitch
              v-model:value="enableScheduledPublish"
              :disabled="submitting"
            />
            <span class="text-sm text-gray-500">到点自动按预设模式发布</span>
          </div>
          <template v-if="enableScheduledPublish">
            <NDatePicker
              v-model:value="scheduledPublishAt"
              type="datetime"
              class="w-full"
              placeholder="选择定时发布时间"
              :is-date-disabled="(ts: number) => ts <= Date.now()"
              :disabled="submitting"
            />
            <NSelect
              v-model:value="scheduledPublishMode"
              :options="[
                { label: '全量发布', value: 'full' },
                { label: '灰度发布', value: 'gray' },
              ]"
              :disabled="submitting"
            />
            <NSelect
              v-if="scheduledPublishMode === 'gray'"
              v-model:value="scheduledGrayPercent"
              :options="scheduledGrayOptions"
              placeholder="定时灰度百分比"
              :disabled="submitting"
            />
          </template>
        </div>
      </NFormItem>
    </NForm>

    <NProgress
      v-if="submitting"
      type="line"
      :percentage="Math.round(progress)"
      indicator-placement="inside"
      processing
    />

    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton :disabled="submitting" @click="handleClose">取消</NButton>
        <NButton type="primary" :loading="submitting" @click="handleSubmit">
          {{ submitting ? '上传中...' : '上传并创建草稿' }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>
