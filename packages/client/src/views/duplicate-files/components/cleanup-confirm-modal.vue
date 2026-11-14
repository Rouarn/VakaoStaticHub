<script setup lang="ts">
import { NIcon } from 'naive-ui';
import { FolderOpenOutline } from '@vicons/ionicons5';
import { formatBytes } from '@/utils/file-types';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import type { CleanupPlan } from './types';

/**
 * 重复文件清理确认：列出每组保留项与将删除的副本数，
 * 实际删除由父级执行
 */
defineProps<{
  show: boolean;
  plans: CleanupPlan[];
  totalRemoving: number;
  loading: boolean;
  rootName: (id: string) => string;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  confirm: [];
}>();
</script>

<template>
  <ConfirmModal
    :show="show"
    title="清理重复文件"
    :content="`将永久删除 ${plans.length} 组中的 ${totalRemoving} 个文件，每组保留 1 个（见下方清单）。删除后不可恢复。`"
    positive-text="确认永久删除"
    :loading="loading"
    @update:show="emit('update:show', $event)"
    @confirm="emit('confirm')"
  >
    <div class="mt-2 max-h-56 overflow-y-auto flex flex-col gap-1.5">
      <div
        v-for="plan in plans"
        :key="plan.group.contentHash"
        class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2 text-11px"
      >
        <p class="m-0 text-ink-sub flex items-center gap-1">
          <NIcon :size="12"><FolderOpenOutline /></NIcon>
          保留：{{ rootName(plan.keep.rootId) }} / {{ plan.keep.category }}
        </p>
        <p class="m-0 text-ink font-600 truncate" :title="plan.keep.relPath">
          {{ plan.keep.name }}
        </p>
        <p class="m-0 text-ink-sub">
          删除其余 {{ plan.remove.length }} 个副本 · 可释放
          {{ formatBytes(plan.group.size * plan.remove.length) }}
        </p>
      </div>
    </div>
  </ConfirmModal>
</template>
