<script setup lang="ts">
import { ref, watch } from 'vue';
import { NModal, NSpin } from 'naive-ui';
import { DocumentTextOutline } from '@vicons/ionicons5';
import type { ShareAccessLog, ShareLink } from '@vakao/shared';
import { listShareAccessLogs } from '@/api/shares';
import { getErrorMessage } from '@/utils/http';
import { formatDateTime } from '@/utils/format';
import ErrorState from '@/components/common/error-state.vue';
import EmptyState from '@/components/common/empty-state.vue';

/** 分享访问记录：打开时按 token 拉取，失败可就地重试 */
const props = defineProps<{
  show: boolean;
  link: ShareLink | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
}>();

const logsLoading = ref(false);
const logsError = ref('');
const logs = ref<ShareAccessLog[]>([]);

async function loadLogs() {
  const link = props.link;
  if (!link) return;
  logsLoading.value = true;
  logsError.value = '';
  logs.value = [];
  try {
    logs.value = await listShareAccessLogs(link.token);
  } catch (e) {
    logsError.value = getErrorMessage(e, '访问记录加载失败');
  } finally {
    logsLoading.value = false;
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) void loadLogs();
  },
);

function retryLogs() {
  void loadLogs();
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="访问记录"
    class="w-640px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <p class="m-0 mb-3 text-11px text-ink-sub font-mono break-all">
      {{ link?.token }}
    </p>
    <NSpin :show="logsLoading">
      <ErrorState v-if="logsError" :message="logsError" @retry="retryLogs" />
      <EmptyState
        v-else-if="!logsLoading && logs.length === 0"
        :icon="DocumentTextOutline"
        title="暂无访问记录"
        description="链接被成功解锁后，这里会记录访问时间、IP 与 User-Agent。解锁失败不会计数。"
      />
      <ul
        v-else
        class="m-0 p-0 list-none flex flex-col gap-2 max-h-100 overflow-y-auto"
      >
        <li
          v-for="log in logs"
          :key="log.id"
          class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/45 dark:bg-white/4 px-3 py-2"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-12px text-ink font-600 tabular-nums">
              {{ formatDateTime(log.accessedAt) }}
            </span>
            <span class="text-11px text-ink-sub">{{
              log.ip ?? 'IP 未知'
            }}</span>
          </div>
          <p class="m-0 mt-1 text-10px text-ink-sub break-all">
            {{ log.userAgent ?? 'UA 未记录' }}
          </p>
        </li>
      </ul>
    </NSpin>
  </NModal>
</template>
