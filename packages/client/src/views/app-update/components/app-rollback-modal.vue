<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NIcon, NModal, NSpin, NTag, useMessage } from 'naive-ui';
import {
  CheckmarkCircleOutline,
  InformationCircleOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import type { RollbackCandidate } from '@vakao/shared';
import {
  APP_VERSION_STATUS,
  getRollbackCandidates,
  rollbackVersion,
} from '@/api/app-update';
import type { AppVersionRecord } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';

/** 回滚确认：打开时拉取候选，仅恢复全量在线/自动下架的最高历史版本 */
const props = defineProps<{
  show: boolean;
  version: AppVersionRecord | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  done: [];
}>();

const message = useMessage();

const rollingBack = ref(false);
const rollbackCandidates = ref<RollbackCandidate[]>([]);
const rollbackLoading = ref(false);
const rollbackError = ref('');

watch(
  () => props.show,
  (show) => {
    const version = props.version;
    if (!show || !version) return;
    rollbackCandidates.value = [];
    rollbackError.value = '';
    void loadCandidates(version);
  },
  { immediate: true },
);

async function loadCandidates(version: AppVersionRecord) {
  rollbackLoading.value = true;
  try {
    const result = await getRollbackCandidates(version.id);
    rollbackCandidates.value = result.candidates;
  } catch (e) {
    rollbackError.value = getErrorMessage(e, '回滚候选加载失败');
  } finally {
    rollbackLoading.value = false;
  }
}

async function confirmRollback() {
  const target = props.version;
  if (!target) return;
  rollingBack.value = true;
  try {
    const result = await rollbackVersion(target.id);
    message.success(
      `已回滚 v${target.versionName}，恢复 v${result.restored.versionName}（vc ${result.restored.versionCode}）上线`,
    );
    emit('update:show', false);
    emit('done');
  } catch (e) {
    message.error(getErrorMessage(e, '回滚失败'));
  } finally {
    rollingBack.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`回滚 v${version?.versionName ?? ''}`"
    class="w-560px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <NSpin :show="rollbackLoading">
      <div class="flex flex-col gap-3">
        <p class="m-0 text-12px text-ink-sub leading-5">
          回滚会把当前版本手动下架，并恢复该应用历史中可恢复的最高版本上线。
          候选仅包含「全量在线」与「自动下架（被新全量顶替）」的版本；手动下架的版本不会恢复。
        </p>

        <div v-if="rollbackError" class="text-12px text-red-500">
          {{ rollbackError }}
        </div>
        <div
          v-else-if="!rollbackLoading && rollbackCandidates.length === 0"
          class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-5 text-center"
        >
          <NIcon :size="22" class="text-ink-sub"
            ><InformationCircleOutline
          /></NIcon>
          <p class="m-0 mt-2 text-12px text-ink-sub">
            当前应用不存在可回滚的历史全量版本（后端会拒绝本次回滚）。
          </p>
        </div>
        <div v-else class="flex flex-col gap-1">
          <div
            v-for="(candidate, index) in rollbackCandidates"
            :key="candidate.id"
            class="flex items-center gap-2 rounded-lg px-3 py-2"
            :class="
              index === 0 ? 'bg-brand-500/10' : 'bg-white/40 dark:bg-white/4'
            "
          >
            <NIcon
              :size="15"
              :class="
                index === 0
                  ? 'text-brand-600 dark:text-brand-400'
                  : 'text-ink-sub'
              "
            >
              <CheckmarkCircleOutline v-if="index === 0" />
              <TimeOutline v-else />
            </NIcon>
            <span class="text-12px text-ink flex-1">
              v{{ candidate.versionName }}
              <span class="text-11px text-ink-sub"
                >vc {{ candidate.versionCode }}</span
              >
            </span>
            <span class="text-11px text-ink-sub">
              {{
                candidate.status === APP_VERSION_STATUS.PUBLISHED
                  ? '全量在线'
                  : '自动下架'
              }}
            </span>
            <NTag
              v-if="index === 0"
              size="tiny"
              type="success"
              :bordered="false"
              >将恢复</NTag
            >
          </div>
        </div>

        <p class="m-0 text-11px text-ink-sub">
          注意：回滚后当前版本为「手动下架」状态；若需再次上线，可在版本列表点击「重新发布」。
        </p>
      </div>
    </NSpin>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="error"
          :loading="rollingBack"
          :disabled="
            rollbackLoading ||
            rollbackCandidates.length === 0 ||
            Boolean(rollbackError)
          "
          @click="confirmRollback"
        >
          确认回滚
        </NButton>
      </div>
    </template>
  </NModal>
</template>
