<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NModal, NTag } from 'naive-ui';
import type { ShareBatchResult } from '@vakao/shared';

/** 批量操作结果：部分失败时如实展示成功/失败条数与原因 */
const props = defineProps<{
  show: boolean;
  result: ShareBatchResult | null;
  retryableCount: number;
  actionLabel: string;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
}>();

const failedItems = computed(
  () => props.result?.results.filter((item) => !item.success) ?? [],
);

function tokenShort(token: string) {
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="批量操作结果"
    class="w-520px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div v-if="result" class="flex flex-col gap-3">
      <div class="flex items-center gap-2 flex-wrap">
        <NTag type="success" :bordered="false" size="small">
          成功 {{ result.succeeded }} 项
        </NTag>
        <NTag
          v-if="result.failed > 0"
          type="error"
          :bordered="false"
          size="small"
        >
          失败 {{ result.failed }} 项
        </NTag>
        <span class="text-11px text-ink-sub">
          共 {{ result.total }} 项 ·
          {{ actionLabel }}
        </span>
      </div>

      <div v-if="result.failed > 0" class="flex flex-col gap-2">
        <p class="m-0 text-11px text-ink-sub">
          <template v-if="retryableCount > 0">
            {{ retryableCount }} 个失败项已保持选中，可直接重试。
          </template>
          <template v-if="result.failed - retryableCount > 0">
            另有
            {{ result.failed - retryableCount }}
            个失败项已不在当前列表（可能已被其他操作删除），无法重试。
          </template>
        </p>
        <ul
          class="m-0 p-0 list-none flex flex-col gap-1.5 max-h-60 overflow-y-auto"
        >
          <li
            v-for="item in failedItems"
            :key="item.token"
            class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2"
          >
            <p class="m-0 text-11px text-ink font-mono" :title="item.token">
              {{ tokenShort(item.token) }}
            </p>
            <p class="m-0 mt-0.5 text-11px text-red-500">
              {{ item.error ?? '未知原因' }}
            </p>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <NButton size="small" @click="emit('update:show', false)">关闭</NButton>
      </div>
    </template>
  </NModal>
</template>
