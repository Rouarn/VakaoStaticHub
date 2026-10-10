<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  NModal,
  NRadioGroup,
  NRadioButton,
  NSelect,
  NAlert,
  NButton,
  NSwitch,
  NInputNumber,
  NIcon,
  useMessage,
} from 'naive-ui';
import { AddOutline, RemoveOutline } from '@vicons/ionicons5';
import { publishVersion, type GrayIncrementStep } from '@/api/app-update';
import { getErrorMessage } from '@/utils/request';
import type { AppVersion } from '@vakao/shared';

const props = defineProps<{ show: boolean; version: AppVersion | null }>();
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'saved'): void;
}>();

const message = useMessage();
const submitting = ref(false);
const mode = ref<'full' | 'gray'>('full');
const grayPercent = ref<number | null>(5);
const autoIncrement = ref(false);
const schedule = ref<GrayIncrementStep[]>([{ hours: 24, percent: 100 }]);

watch(
  () => props.show,
  (show) => {
    if (show) {
      mode.value = 'full';
      grayPercent.value = 5;
      autoIncrement.value = false;
      schedule.value = [{ hours: 24, percent: 100 }];
    }
  },
);

const percentOptions = Array.from({ length: 99 }, (_, i) => ({
  label: `${i + 1}%`,
  value: i + 1,
}));

const grayError = computed(() =>
  mode.value === 'gray' && !grayPercent.value ? '请选择灰度百分比' : '',
);

const scheduleError = computed(() => {
  if (mode.value !== 'gray' || !autoIncrement.value) return '';
  if (schedule.value.length === 0) return '请至少添加一条递增规则';
  for (const s of schedule.value) {
    if (!s.hours || s.hours < 1) return '递增规则的小时后数必须 ≥ 1';
    if (!s.percent || s.percent < 1 || s.percent > 100)
      return '目标百分比需在 1~100 之间';
  }
  return '';
});

function addStep() {
  const last = schedule.value[schedule.value.length - 1];
  schedule.value.push({
    hours: (last?.hours ?? 0) + 24,
    percent: 100,
  });
}

function removeStep(index: number) {
  schedule.value.splice(index, 1);
}

async function handleConfirm() {
  if (grayError.value || scheduleError.value) {
    message.error(scheduleError.value || grayError.value);
    return;
  }
  if (!props.version) return;
  submitting.value = true;
  try {
    await publishVersion(props.version.id, {
      mode: mode.value,
      grayPercent: mode.value === 'gray' ? grayPercent.value! : undefined,
      grayAutoIncrement:
        mode.value === 'gray' ? autoIncrement.value : undefined,
      grayIncrementSchedule:
        mode.value === 'gray' && autoIncrement.value
          ? [...schedule.value].sort((a, b) => a.hours - b.hours)
          : undefined,
    });
    message.success(
      mode.value === 'full'
        ? '已全量发布'
        : `已灰度发布 ${grayPercent.value}%${autoIncrement.value ? '（自动递增已开启）' : ''}`,
    );
    emit('saved');
    emit('update:show', false);
  } catch (err) {
    message.error(getErrorMessage(err, '发布失败'));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :title="`发布版本 v${props.version?.versionName ?? ''} (${props.version?.versionCode ?? ''})`"
    class="w-[520px]"
    :mask-closable="!submitting"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="flex flex-col gap-4">
      <NRadioGroup v-model:value="mode" :disabled="submitting">
        <NRadioButton value="full">全量发布</NRadioButton>
        <NRadioButton value="gray">灰度发布</NRadioButton>
      </NRadioGroup>

      <template v-if="mode === 'gray'">
        <NSelect
          v-model:value="grayPercent"
          :options="percentOptions"
          placeholder="灰度百分比（命中的设备可见更新）"
          :status="grayError ? 'error' : undefined"
          :disabled="submitting"
        />

        <div class="flex items-center gap-2">
          <NSwitch v-model:value="autoIncrement" :disabled="submitting" />
          <span class="text-sm"
            >灰度自动递增（按时间表自动扩量，达 100% 自动转全量）</span
          >
        </div>

        <div v-if="autoIncrement" class="flex flex-col gap-2">
          <div
            v-for="(step, index) in schedule"
            :key="index"
            class="flex items-center gap-2"
          >
            <span class="text-xs text-gray-500 whitespace-nowrap">发布</span>
            <NInputNumber
              v-model:value="step.hours"
              :min="1"
              :precision="0"
              size="small"
              class="w-24"
              :disabled="submitting"
            />
            <span class="text-xs text-gray-500 whitespace-nowrap"
              >小时后扩量至</span
            >
            <NInputNumber
              v-model:value="step.percent"
              :min="1"
              :max="100"
              :precision="0"
              size="small"
              class="w-24"
              :disabled="submitting"
            />
            <span class="text-xs text-gray-500">%</span>
            <NButton
              quaternary
              circle
              size="tiny"
              :disabled="submitting || schedule.length <= 1"
              @click="removeStep(index)"
            >
              <template #icon>
                <NIcon :component="RemoveOutline" />
              </template>
            </NButton>
          </div>
          <div>
            <NButton
              size="tiny"
              quaternary
              :disabled="submitting"
              @click="addStep"
            >
              <template #icon>
                <NIcon :component="AddOutline" />
              </template>
              添加递增规则
            </NButton>
          </div>
          <p v-if="scheduleError" class="text-xs text-red-500">
            {{ scheduleError }}
          </p>
        </div>
      </template>

      <NAlert type="info" :show-icon="false">
        <template v-if="mode === 'gray'">
          仅 deviceId
          稳定哈希命中的设备可检测到此版本，其余设备回落到最近全量版本。
        </template>
        <template v-else>
          发布门禁：versionCode 必须大于当前全量最大版本，否则将被拒绝。
        </template>
      </NAlert>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton :disabled="submitting" @click="emit('update:show', false)">
          取消
        </NButton>
        <NButton type="primary" :loading="submitting" @click="handleConfirm">
          确认发布
        </NButton>
      </div>
    </template>
  </NModal>
</template>
