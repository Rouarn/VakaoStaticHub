<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  NButton,
  NIcon,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  CloseCircleOutline,
  InformationCircleOutline,
} from '@vicons/ionicons5';
import type { GrayIncrementStep } from '@vakao/shared';
import { publishVersion } from '@/api/app-update';
import type { AppVersionRecord, PublishBody } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';

/** 发布弹窗：全量或灰度，灰度可选自动递增步骤 */
const props = defineProps<{
  show: boolean;
  version: AppVersionRecord | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  done: [];
}>();

const message = useMessage();

const publishing = ref(false);
const publishForm = ref<{
  mode: 'full' | 'gray';
  grayPercent: number;
  autoIncrement: boolean;
  schedule: GrayIncrementStep[];
}>({ mode: 'full', grayPercent: 20, autoIncrement: false, schedule: [] });

watch(
  () => props.show,
  (show) => {
    const version = props.version;
    if (!show || !version) return;
    publishForm.value = {
      mode: 'full',
      grayPercent:
        version.grayPercent > 0 ? Math.min(99, version.grayPercent) : 20,
      autoIncrement: false,
      schedule: [
        { hours: 24, percent: 50 },
        { hours: 72, percent: 100 },
      ],
    };
  },
  { immediate: true },
);

function addScheduleStep() {
  publishForm.value.schedule.push({ hours: 24, percent: 50 });
}

function removeScheduleStep(index: number) {
  publishForm.value.schedule.splice(index, 1);
}

async function submitPublish() {
  const target = props.version;
  if (!target) return;
  const f = publishForm.value;
  if (f.mode === 'gray') {
    if (f.grayPercent < 1 || f.grayPercent > 99) {
      message.warning('灰度百分比必须在 1~99');
      return;
    }
    if (f.autoIncrement && f.schedule.length === 0) {
      message.warning('开启自动递增时必须提供至少一个递增步骤');
      return;
    }
    if (f.autoIncrement) {
      for (const step of f.schedule) {
        if (step.hours <= 0 || step.percent < 1 || step.percent > 100) {
          message.warning('递增步骤的 hours 需大于 0，percent 需在 1~100');
          return;
        }
      }
    }
  }
  const body: PublishBody = { mode: f.mode };
  if (f.mode === 'gray') {
    body.grayPercent = f.grayPercent;
    body.grayAutoIncrement = f.autoIncrement;
    if (f.autoIncrement) {
      body.grayIncrementSchedule = [...f.schedule].sort(
        (a, b) => a.hours - b.hours,
      );
    }
  }
  publishing.value = true;
  try {
    await publishVersion(target.id, body);
    message.success(
      f.mode === 'gray'
        ? `已灰度发布 v${target.versionName}（${f.grayPercent}%${f.autoIncrement ? '，自动递增' : ''}）`
        : `已全量发布 v${target.versionName}`,
    );
    emit('update:show', false);
    emit('done');
  } catch (e) {
    message.error(getErrorMessage(e, '发布失败'));
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`发布 v${version?.versionName ?? ''}`"
    class="w-560px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-3">
      <NRadioGroup v-model:value="publishForm.mode" size="small">
        <NRadioButton value="full">全量发布</NRadioButton>
        <NRadioButton value="gray">灰度发布</NRadioButton>
      </NRadioGroup>

      <template v-if="publishForm.mode === 'gray'">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">灰度百分比（1~99）</span>
          <NInputNumber
            v-model:value="publishForm.grayPercent"
            size="small"
            :min="1"
            :max="99"
          />
        </label>

        <div class="flex items-center gap-2">
          <NSwitch v-model:value="publishForm.autoIncrement" size="small" />
          <span class="text-12px text-ink">灰度自动递增</span>
          <NTooltip :delay="300">
            <template #trigger>
              <NIcon :size="14" class="text-ink-sub"
                ><InformationCircleOutline
              /></NIcon>
            </template>
            后端每小时按发布时间匹配递增表；percent 达 100 时自动转全量
          </NTooltip>
        </div>

        <div v-if="publishForm.autoIncrement" class="flex flex-col gap-2">
          <div
            v-for="(step, index) in publishForm.schedule"
            :key="index"
            class="flex items-center gap-2"
          >
            <span class="text-11px text-ink-sub shrink-0">发布后</span>
            <NInputNumber
              v-model:value="step.hours"
              size="tiny"
              :min="1"
              :max="8760"
              class="w-24"
            />
            <span class="text-11px text-ink-sub shrink-0">小时 →</span>
            <NInputNumber
              v-model:value="step.percent"
              size="tiny"
              :min="1"
              :max="100"
              class="w-24"
            />
            <span class="text-11px text-ink-sub shrink-0">%</span>
            <NButton
              size="tiny"
              quaternary
              type="error"
              :disabled="publishForm.schedule.length <= 1"
              @click="removeScheduleStep(index)"
            >
              <template #icon
                ><NIcon><CloseCircleOutline /></NIcon
              ></template>
            </NButton>
          </div>
          <NButton
            size="tiny"
            quaternary
            class="self-start"
            @click="addScheduleStep"
          >
            <template #icon
              ><NIcon><AddOutline /></NIcon
            ></template>
            增加递增步骤
          </NButton>
        </div>
      </template>

      <p class="m-0 text-11px text-ink-sub leading-5">
        发布门禁：versionCode
        必须大于该应用当前全量最大版本；全量发布会把同应用旧的在线版本
        自动下架（offlineReason=auto，可被回滚恢复）。手动下架（manual）不会被回滚恢复。
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="publishing"
          @click="submitPublish"
        >
          确认发布
        </NButton>
      </div>
    </template>
  </NModal>
</template>
