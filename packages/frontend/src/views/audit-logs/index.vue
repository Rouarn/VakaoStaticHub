<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import {
  NButton,
  NDatePicker,
  NDrawer,
  NDrawerContent,
  NIcon,
  NInput,
  NPagination,
  NSelect,
  NSpin,
  NTag,
} from 'naive-ui';
import {
  DocumentTextOutline,
  EyeOutline,
  InformationCircleOutline,
  RefreshOutline,
  SearchOutline,
} from '@vicons/ionicons5';
import type { AuditLog, AuditLogPage } from '@vakao/shared';
import {
  ACTION_LABELS,
  ACTION_OPTIONS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_OPTIONS,
  listAuditLogs,
} from '@/api/audit-logs';
import { getErrorMessage } from '@/utils/http';
import { formatDateTime } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';

/** 审计日志：后端分页 + 操作人/动作/资源/时间筛选 + 详情抽屉 */

const data = ref<AuditLogPage>({ items: [], total: 0, page: 1, pageSize: 20 });
const loading = ref(false);
const error = ref('');

const page = ref(1);
const pageSize = ref(20);
const username = ref('');
const action = ref('');
const resourceType = ref('');
const range = ref<[number, number] | null>(null);

const actionOptions = [
  { label: '全部动作', value: '' },
  ...ACTION_OPTIONS.map((value) => ({
    label: ACTION_LABELS[value] ?? value,
    value,
  })),
];
const resourceOptions = [
  { label: '全部资源', value: '' },
  ...RESOURCE_TYPE_OPTIONS.map((value) => ({
    label: RESOURCE_TYPE_LABELS[value] ?? value,
    value,
  })),
];

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [start, end] = range.value ?? [];
    data.value = await listAuditLogs({
      page: page.value,
      pageSize: pageSize.value,
      ...(username.value.trim() ? { username: username.value.trim() } : {}),
      ...(action.value ? { action: action.value } : {}),
      ...(resourceType.value ? { resourceType: resourceType.value } : {}),
      ...(start !== undefined ? { startTime: start } : {}),
      ...(end !== undefined ? { endTime: end + 86_399_999 } : {}),
    });
  } catch (e) {
    error.value = getErrorMessage(e, '审计日志加载失败');
    data.value = {
      items: [],
      total: 0,
      page: page.value,
      pageSize: pageSize.value,
    };
  } finally {
    loading.value = false;
  }
}

function resetAndLoad() {
  page.value = 1;
  void load();
}

watch([action, resourceType, range], resetAndLoad);
watch(page, () => void load());
watch(pageSize, resetAndLoad);
watch(
  username,
  useDebounceFn(() => resetAndLoad(), 400),
);

// ===================== 详情 =====================
const drawerShow = ref(false);
const current = ref<AuditLog | null>(null);

function openDetail(log: AuditLog) {
  current.value = log;
  drawerShow.value = true;
}

const prettyDetails = computed(() => {
  const raw = current.value?.details;
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
});

function clearFilters() {
  username.value = '';
  action.value = '';
  resourceType.value = '';
  range.value = null;
  page.value = 1;
  void load();
}

onMounted(() => void load());
</script>

<template>
  <div class="flex flex-col gap-4 animate-fade-up">
    <PageHeader
      title="审计日志"
      description="记录登录、文件、分享与 APP 版本等关键操作，支持按操作人/动作/资源/时间筛选"
      :icon="DocumentTextOutline"
    >
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon
            ><NIcon><RefreshOutline /></NIcon
          ></template>
          刷新
        </NButton>
      </template>
    </PageHeader>

    <!-- 筛选 -->
    <section class="glass-panel px-4 py-3 flex flex-wrap items-center gap-2">
      <NInput
        v-model:value="username"
        size="small"
        clearable
        placeholder="操作人"
        class="w-36"
      >
        <template #prefix
          ><NIcon :size="14"><SearchOutline /></NIcon
        ></template>
      </NInput>
      <NSelect
        v-model:value="action"
        size="small"
        class="w-44"
        :options="actionOptions"
        placeholder="动作"
      />
      <NSelect
        v-model:value="resourceType"
        size="small"
        class="w-32"
        :options="resourceOptions"
        placeholder="资源类型"
      />
      <NDatePicker
        v-model:value="range"
        type="daterange"
        size="small"
        clearable
        class="w-64"
        @update:value="resetAndLoad"
      />
      <NButton size="small" quaternary @click="clearFilters">清空筛选</NButton>
      <span class="ml-auto text-11px text-ink-sub">
        共 {{ data.total.toLocaleString() }} 条 · 后端分页
      </span>
    </section>

    <NSpin :show="loading">
      <ErrorState v-if="error" :message="error" @retry="load" />

      <EmptyState
        v-else-if="!loading && data.items.length === 0"
        :icon="DocumentTextOutline"
        title="没有匹配的审计记录"
        :description="
          data.total === 0
            ? '关键操作发生后会自动写入审计日志，包括登录、上传、分享、发布与删除。'
            : '当前筛选条件下没有结果，试试清空筛选或扩大时间范围。'
        "
      >
        <NButton size="small" @click="clearFilters">清空筛选</NButton>
      </EmptyState>

      <div v-else class="flex flex-col gap-3">
        <section class="glass-panel px-4 py-2">
          <div class="overflow-x-auto">
            <table class="w-full min-w-760px border-collapse text-12px">
              <thead>
                <tr class="text-left text-11px text-ink-sub">
                  <th class="py-2 pr-3 font-500 w-40">时间</th>
                  <th class="py-2 px-2 font-500 w-32">操作人</th>
                  <th class="py-2 px-2 font-500 w-40">动作</th>
                  <th class="py-2 px-2 font-500 w-28">资源</th>
                  <th class="py-2 px-2 font-500">IP</th>
                  <th class="py-2 pl-2 font-500 text-right w-20">详情</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="log in data.items"
                  :key="log.id"
                  class="border-t border-glass-border/60 dark:border-glass-border-dark/60 hover:bg-brand-500/5"
                >
                  <td
                    class="py-2.5 pr-3 text-ink-sub tabular-nums whitespace-nowrap"
                  >
                    {{ formatDateTime(log.createdAt) }}
                  </td>
                  <td class="py-2.5 px-2">
                    <span
                      class="text-ink truncate max-w-28"
                      :title="log.username"
                    >
                      {{ log.username }}
                    </span>
                  </td>
                  <td class="py-2.5 px-2">
                    <NTag
                      size="tiny"
                      :bordered="false"
                      type="info"
                      :title="log.action"
                      >{{ ACTION_LABELS[log.action] ?? log.action }}</NTag
                    >
                  </td>
                  <td class="py-2.5 px-2 max-w-44">
                    <p class="m-0 text-12px text-ink-sub">
                      {{
                        RESOURCE_TYPE_LABELS[log.resourceType] ??
                        log.resourceType
                      }}
                    </p>
                    <p
                      v-if="log.resourceId"
                      class="m-0 text-10px text-ink-sub font-mono truncate"
                      :title="log.resourceId"
                    >
                      #{{ log.resourceId }}
                    </p>
                  </td>
                  <td class="py-2.5 px-2 text-ink-sub font-mono text-11px">
                    {{ log.ip ?? '—' }}
                  </td>
                  <td class="py-2.5 pl-2 text-right">
                    <NButton size="tiny" quaternary @click="openDetail(log)">
                      <template #icon
                        ><NIcon><EyeOutline /></NIcon
                      ></template>
                    </NButton>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <footer class="glass-panel px-4 py-2 flex items-center justify-end">
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="data.total"
            :page-sizes="[20, 50, 100]"
            show-size-picker
          />
        </footer>
      </div>
    </NSpin>

    <!-- 详情抽屉 -->
    <NDrawer v-model:show="drawerShow" :width="560" placement="right">
      <NDrawerContent
        :title="
          current
            ? (ACTION_LABELS[current.action] ?? current.action)
            : '审计详情'
        "
        closable
      >
        <div v-if="current" class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-2 text-12px">
            <div class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2">
              <p class="m-0 text-10px text-ink-sub">时间</p>
              <p class="m-0 mt-0.5 text-ink tabular-nums">
                {{ formatDateTime(current.createdAt) }}
              </p>
            </div>
            <div class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2">
              <p class="m-0 text-10px text-ink-sub">操作人</p>
              <p class="m-0 mt-0.5 text-ink">
                {{ current.username }}（#{{ current.userId ?? '—' }}）
              </p>
            </div>
            <div class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2">
              <p class="m-0 text-10px text-ink-sub">动作</p>
              <p class="m-0 mt-0.5 text-ink" :title="current.action">
                {{ ACTION_LABELS[current.action] ?? current.action }}
              </p>
            </div>
            <div class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2">
              <p class="m-0 text-10px text-ink-sub">资源</p>
              <p class="m-0 mt-0.5 text-ink break-all">
                {{
                  RESOURCE_TYPE_LABELS[current.resourceType] ??
                  current.resourceType
                }}{{ current.resourceId ? ` / ${current.resourceId}` : '' }}
              </p>
            </div>
            <div
              class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2 col-span-2"
            >
              <p class="m-0 text-10px text-ink-sub">IP</p>
              <p class="m-0 mt-0.5 text-ink font-mono text-11px">
                {{ current.ip ?? '—' }}
              </p>
            </div>
            <div
              class="rounded-lg bg-white/45 dark:bg-white/4 px-3 py-2 col-span-2"
            >
              <p class="m-0 text-10px text-ink-sub">User-Agent</p>
              <p class="m-0 mt-0.5 text-ink text-11px break-all">
                {{ current.userAgent ?? '—' }}
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-1.5">
            <p class="m-0 text-12px font-600 text-ink flex items-center gap-1">
              <NIcon :size="14"><InformationCircleOutline /></NIcon>
              操作详情
            </p>
            <pre
              v-if="prettyDetails"
              class="m-0 max-h-96 overflow-auto rounded-xl bg-black/4 dark:bg-black/30 border border-glass-border dark:border-glass-border-dark p-3 text-11px leading-5 text-ink-sub font-mono"
              >{{ prettyDetails }}</pre>
            <p v-else class="m-0 text-11px text-ink-sub">无附加详情</p>
          </div>
        </div>
      </NDrawerContent>
    </NDrawer>
  </div>
</template>
