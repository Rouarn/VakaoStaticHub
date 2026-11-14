<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  NButton,
  NDatePicker,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSwitch,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  CloudUploadOutline,
  DocumentTextOutline,
  InformationCircleOutline,
} from '@vicons/ionicons5';
import { createVersion } from '@/api/app-update';
import type { AppVersionRecord } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';

/** 上传 APK：本地校验扩展名/大小/ZIP 魔数，成功后创建草稿版本 */
const props = defineProps<{
  show: boolean;
  apps: string[];
  activeApp: string;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  uploaded: [string];
}>();

const message = useMessage();

const uploading = ref(false);
const uploadPercent = ref(0);
const uploadError = ref('');
const uploadResult = ref<AppVersionRecord | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pickedFile = ref<File | null>(null);
const pickedError = ref('');
const uploadForm = ref({
  appKey: '',
  versionName: '',
  versionCode: 1,
  updateLog: '',
  remark: '',
  scheduled: false,
  scheduledAt: null as number | null,
  scheduledMode: 'full' as 'full' | 'gray',
  scheduledGrayPercent: 20,
});
const MAX_APK = 500 * 1024 * 1024;

watch(
  () => props.show,
  (show) => {
    if (!show) return;
    uploadForm.value = {
      appKey: props.activeApp || props.apps[0] || '',
      versionName: '',
      versionCode: 1,
      updateLog: '',
      remark: '',
      scheduled: false,
      scheduledAt: null,
      scheduledMode: 'full',
      scheduledGrayPercent: 20,
    };
    pickedFile.value = null;
    pickedError.value = '';
    uploadError.value = '';
    uploadPercent.value = 0;
    uploadResult.value = null;
  },
);

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  pickedFile.value = null;
  pickedError.value = '';
  uploadResult.value = null;
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.apk')) {
    pickedError.value = '文件扩展名必须为 .apk';
    input.value = '';
    return;
  }
  if (file.size <= 0) {
    pickedError.value = '文件为空';
    input.value = '';
    return;
  }
  if (file.size > MAX_APK) {
    pickedError.value = `文件超过 500MB 上限（当前 ${formatBytes(file.size)}）`;
    input.value = '';
    return;
  }

  // 客户端 ZIP 魔数校验（PK\x03\x04），与后端一致，提前拦截改名的非 APK 文件
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (
      head[0] !== 0x50 ||
      head[1] !== 0x4b ||
      head[2] !== 0x03 ||
      head[3] !== 0x04
    ) {
      pickedError.value = '文件内容不是合法的 APK（ZIP）包';
      input.value = '';
      return;
    }
  } catch {
    pickedError.value = '读取文件失败';
    input.value = '';
    return;
  }

  pickedFile.value = file;
  if (!uploadForm.value.versionName) {
    uploadForm.value.versionName = file.name.replace(/\.apk$/i, '');
  }
}

async function submitUpload() {
  const file = pickedFile.value;
  if (!file) {
    message.warning('请选择 APK 文件');
    return;
  }
  if (!uploadForm.value.appKey) {
    message.warning('请选择应用');
    return;
  }
  if (!uploadForm.value.versionName.trim()) {
    message.warning('请填写版本名');
    return;
  }
  if (!uploadForm.value.versionCode || uploadForm.value.versionCode <= 0) {
    message.warning('versionCode 必须大于 0');
    return;
  }
  if (uploadForm.value.scheduled) {
    if (!uploadForm.value.scheduledAt) {
      message.warning('请选择定时发布时间');
      return;
    }
    if (uploadForm.value.scheduledAt <= Date.now()) {
      message.warning('定时发布时间必须晚于当前时间');
      return;
    }
    if (
      uploadForm.value.scheduledMode === 'gray' &&
      (uploadForm.value.scheduledGrayPercent < 1 ||
        uploadForm.value.scheduledGrayPercent > 99)
    ) {
      message.warning('定时灰度百分比必须在 1~99');
      return;
    }
  }

  const form = new FormData();
  form.append('file', file, file.name);
  form.append('appKey', uploadForm.value.appKey);
  form.append('versionName', uploadForm.value.versionName.trim());
  form.append('versionCode', String(uploadForm.value.versionCode));
  if (uploadForm.value.updateLog.trim())
    form.append('updateLog', uploadForm.value.updateLog.trim());
  if (uploadForm.value.remark.trim())
    form.append('remark', uploadForm.value.remark.trim());
  if (uploadForm.value.scheduled && uploadForm.value.scheduledAt) {
    form.append('scheduledPublishAt', String(uploadForm.value.scheduledAt));
    form.append('scheduledPublishMode', uploadForm.value.scheduledMode);
    if (uploadForm.value.scheduledMode === 'gray') {
      form.append(
        'scheduledGrayPercent',
        String(uploadForm.value.scheduledGrayPercent),
      );
    }
  }

  uploading.value = true;
  uploadPercent.value = 0;
  uploadError.value = '';
  try {
    const result = await createVersion(form, (percent) => {
      uploadPercent.value = percent;
    });
    uploadResult.value = result;
    message.success('APK 上传成功，已创建草稿版本');
    emit('uploaded', result.appKey);
  } catch (e) {
    uploadError.value = getErrorMessage(e, 'APK 上传失败');
  } finally {
    uploading.value = false;
  }
}

function clearPicked() {
  pickedFile.value = null;
  pickedError.value = '';
  uploadResult.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

/** 定时发布时间不允许选过去（后端同样拒绝） */
function isPastDate(timestamp: number) {
  return timestamp < Date.now() - 86_400_000;
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="上传 APK"
    class="w-680px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">应用</span>
          <NSelect
            v-model:value="uploadForm.appKey"
            size="small"
            :options="apps.map((a) => ({ label: a, value: a }))"
            placeholder="选择应用"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">版本名</span>
          <NInput
            v-model:value="uploadForm.versionName"
            size="small"
            placeholder="如 1.0.2"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">versionCode</span>
          <NInputNumber
            v-model:value="uploadForm.versionCode"
            size="small"
            :min="1"
            :max="2147483647"
          />
        </label>
      </div>

      <!-- 文件选择 -->
      <div
        class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-4 flex flex-col gap-2"
      >
        <input
          ref="fileInput"
          type="file"
          accept=".apk,application/vnd.android.package-archive"
          class="hidden"
          @change="onFileChange"
        />
        <div v-if="!pickedFile" class="flex items-center gap-3 flex-wrap">
          <NButton size="small" @click="fileInput?.click()">
            <template #icon
              ><NIcon><CloudUploadOutline /></NIcon
            ></template>
            选择 APK 文件
          </NButton>
          <span class="text-11px text-ink-sub"
            >仅 .apk，最大 500MB；本地校验 ZIP 魔数</span
          >
        </div>
        <div v-else class="flex items-center gap-3 flex-wrap">
          <NIcon :size="18" class="text-brand-600 dark:text-brand-400"
            ><DocumentTextOutline
          /></NIcon>
          <span class="min-w-0 flex-1">
            <span class="block text-12px text-ink truncate">{{
              pickedFile.name
            }}</span>
            <span class="block text-11px text-ink-sub">{{
              formatBytes(pickedFile.size)
            }}</span>
          </span>
          <NButton
            size="tiny"
            quaternary
            :disabled="uploading"
            @click="clearPicked"
            >重新选择</NButton
          >
        </div>
        <p v-if="pickedError" class="m-0 text-12px text-red-500">
          {{ pickedError }}
        </p>
        <div
          v-if="uploading"
          class="h-2 rounded-full bg-ink-sub/10 overflow-hidden"
        >
          <div
            class="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all"
            :style="{ width: `${uploadPercent}%` }"
          />
        </div>
        <p v-if="uploading" class="m-0 text-11px text-ink-sub">
          上传中 {{ uploadPercent }}%
        </p>
        <p v-if="uploadError" class="m-0 text-12px text-red-500 leading-5">
          {{ uploadError }}
        </p>
        <div
          v-if="uploadResult"
          class="rounded-lg bg-brand-500/8 px-3 py-2 flex flex-col gap-1"
        >
          <span class="text-12px text-ink font-600">上传成功 · 草稿已创建</span>
          <span class="text-10px text-ink-sub font-mono break-all"
            >SHA-256 {{ uploadResult.checksum }}</span
          >
          <span class="text-10px text-ink-sub"
            >大小 {{ formatBytes(uploadResult.packageSize) }}</span
          >
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">更新说明</span>
          <NInput
            v-model:value="uploadForm.updateLog"
            type="textarea"
            size="small"
            :rows="2"
            placeholder="支持换行"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">内部备注</span>
          <NInput
            v-model:value="uploadForm.remark"
            type="textarea"
            size="small"
            :rows="2"
            placeholder="仅管理端可见"
          />
        </label>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <NSwitch v-model:value="uploadForm.scheduled" size="small" />
          <span class="text-12px text-ink">创建后定时发布</span>
          <NTooltip :delay="300">
            <template #trigger>
              <NIcon :size="14" class="text-ink-sub"
                ><InformationCircleOutline
              /></NIcon>
            </template>
            后端每 10 分钟扫描一次到点的草稿；发布失败会清除定时设置
          </NTooltip>
        </div>
        <div
          v-if="uploadForm.scheduled"
          class="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <label class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-11px text-ink-sub">发布时间</span>
            <NDatePicker
              v-model:value="uploadForm.scheduledAt"
              type="datetime"
              size="small"
              clearable
              :is-date-disabled="isPastDate"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11px text-ink-sub">发布模式</span>
            <NRadioGroup v-model:value="uploadForm.scheduledMode" size="small">
              <NRadioButton value="full">全量</NRadioButton>
              <NRadioButton value="gray">灰度</NRadioButton>
            </NRadioGroup>
          </label>
          <label
            v-if="uploadForm.scheduledMode === 'gray'"
            class="flex flex-col gap-1"
          >
            <span class="text-11px text-ink-sub">灰度百分比</span>
            <NInputNumber
              v-model:value="uploadForm.scheduledGrayPercent"
              size="small"
              :min="1"
              :max="99"
            />
          </label>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <span class="text-11px text-ink-sub"
          >仅创建草稿，发布需前往版本操作</span
        >
        <div class="flex gap-2">
          <NButton
            size="small"
            :disabled="uploading"
            @click="emit('update:show', false)"
            >关闭</NButton
          >
          <NButton
            size="small"
            type="primary"
            :loading="uploading"
            :disabled="!pickedFile"
            @click="submitUpload"
          >
            上传并创建草稿
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>
