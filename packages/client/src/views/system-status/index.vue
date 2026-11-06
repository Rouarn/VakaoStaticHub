<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton, NIcon, NSelect, NTag } from 'naive-ui';
import {
  AlertCircleOutline,
  CheckmarkCircleOutline,
  HardwareChipOutline,
  PauseOutline,
  PlayOutline,
  PulseOutline,
  RefreshOutline,
  RocketOutline,
  SaveOutline,
  ServerOutline,
  ShareSocialOutline,
  SpeedometerOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import type { SystemMetrics } from '@vakao/shared';
import { getSystemMetrics } from '@/api/metrics';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import { formatUptime, percentOf } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import StatCard from '@/components/common/stat-card.vue';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';
import BarList from '@/components/charts/bar-list.vue';

/**
 * 系统状态
 *
 * 数据来自 GET /metrics：
 * - health 段独立返回数据库可达性与数据库文件大小（未落盘/不可读时为 null）
 * - storage / roots 的 totalSize 在无索引数据时为 null，界面显示「—」而不是 0 B
 */
const data = ref<SystemMetrics | null>(null);
/**
 * 加载态：仅首次进入与重试时显示遮罩；
 * 30 秒静默刷新与手动「立即刷新」都不显示遮罩，前者无任何反馈，后者只让按钮转圈并提示结果。
 */
const { loading, loadingText, refreshing, refresh } = useListLoading({
  text: '正在加载系统指标…',
});
const error = ref('');
const lastUpdated = ref<number | null>(null);

const refreshMs = ref(30_000);
const paused = ref(false);
const intervalOptions = [
  { label: '15 秒', value: 15_000 },
  { label: '30 秒', value: 30_000 },
  { label: '60 秒', value: 60_000 },
];

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * silent=true：不显示遮罩（自动刷新与手动刷新共用）
 * throwOnError=true：失败时抛给 useListLoading.refresh 统一提示，界面保留上次成功的数据
 */
async function load(options: { silent?: boolean; throwOnError?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  error.value = '';
  try {
    data.value = await getSystemMetrics();
    lastUpdated.value = Date.now();
  } catch (e) {
    error.value = getErrorMessage(e, '系统指标获取失败');
    if (options.throwOnError) throw e;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

/** 页头「立即刷新」：不走遮罩，只让按钮转圈，结束后提示结果 */
function refreshNow() {
  void refresh(
    () => load({ silent: true, throwOnError: true }),
    () => `当前 ${rootItems.value.length} 个资源目录`,
    '系统指标刷新失败',
  );
}

function restartTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (paused.value) return;
  timer = setInterval(() => void load({ silent: true }), refreshMs.value);
}

watch([refreshMs, paused], restartTimer);

onMounted(() => {
  void load();
  restartTimer();
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const healthy = computed(
  () => data.value?.health.status === 'ok' && !error.value,
);

/** 无数据（null）时展示「—」，避免把“未采集”误读成 0 字节 */
function formatBytesOrDash(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? '—' : formatBytes(bytes);
}

const memoryItems = computed(() => {
  const memory = data.value?.memory;
  if (!memory) return [];
  return [
    { label: 'RSS 常驻内存', value: memory.rss },
    { label: '堆总量 Heap Total', value: memory.heapTotal },
    { label: '堆已用 Heap Used', value: memory.heapUsed },
    { label: '外部内存 External', value: memory.external },
  ];
});

const heapPercent = computed(() => {
  const memory = data.value?.memory;
  if (!memory || memory.heapTotal <= 0) return 0;
  return percentOf(memory.heapUsed, memory.heapTotal);
});

const EVENT_LABELS: Record<string, string> = {
  check_no_update: '检查更新（无新版本）',
  prompt_show: '升级提示展示',
  download_start: '下载开始',
  download_success: '下载完成',
  download_fail: '下载失败',
  verify_fail: '校验失败',
  install_success: '安装成功',
  install_fail: '安装失败',
  new_version_launch: '新版本启动',
};

const upgradeEventItems = computed(() =>
  Object.entries(data.value?.upgradeEvents24h ?? {})
    .filter(([, value]) => value !== null)
    .map(([key, value]) => ({
      label: EVENT_LABELS[key] ?? key,
      value: value as number,
    }))
    .sort((a, b) => b.value - a.value),
);

/** 最近 24 小时没有任何数据的事件类型数量（后端返回 null） */
const upgradeEventMissingCount = computed(
  () =>
    Object.values(data.value?.upgradeEvents24h ?? {}).filter(
      (value) => value === null,
    ).length,
);

const upgradeEventTotal = computed(() =>
  upgradeEventItems.value.reduce((sum, item) => sum + item.value, 0),
);

const rootItems = computed(() => data.value?.roots ?? []);

const largestRoot = computed(() => {
  const sorted = [...rootItems.value].sort(
    (a, b) => (b.totalSize ?? -1) - (a.totalSize ?? -1),
  );
  return sorted[0];
});

/** 根目录占总存储的百分比；任一侧无数据时返回 null（界面显示「—」） */
function rootShare(totalSize: number | null): number | null {
  const grandTotal = data.value?.storage.totalSize;
  if (totalSize === null || grandTotal === null || grandTotal === undefined) {
    return null;
  }
  return percentOf(totalSize, grandTotal);
}

function rootShareLabel(totalSize: number | null): string {
  const share = rootShare(totalSize);
  return share === null ? '—' : `${share}%`;
}
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4">
    <PageHeader
      title="系统状态"
      description="服务运行指标：健康、运行时长、内存、存储、分享与升级事件（GET /metrics）"
      :icon="SpeedometerOutline"
    >
      <template #actions>
        <NSelect
          v-model:value="refreshMs"
          size="small"
          class="w-28"
          :options="intervalOptions"
          :disabled="paused"
        />
        <NButton size="small" quaternary @click="paused = !paused">
          <template #icon>
            <NIcon
              ><component :is="paused ? PlayOutline : PauseOutline"
            /></NIcon>
          </template>
          {{ paused ? '恢复刷新' : '暂停刷新' }}
        </NButton>
        <NButton
          size="small"
          quaternary
          :loading="refreshing"
          :disabled="refreshing"
          @click="refreshNow"
        >
          <template #icon
            ><NIcon><RefreshOutline /></NIcon
          ></template>
          立即刷新
        </NButton>
      </template>
    </PageHeader>

    <!-- 状态条 -->
    <section
      class="glass-panel shrink-0 px-4 py-3 flex items-center gap-3 flex-wrap"
    >
      <div
        class="w-2.5 h-2.5 rounded-full shrink-0"
        :class="healthy ? 'bg-emerald-500' : 'bg-red-500'"
      />
      <p class="m-0 text-13px font-600 text-ink">
        {{ healthy ? '服务运行正常' : '服务指标获取失败' }}
      </p>
      <p class="m-0 text-11px text-ink-sub">
        {{ paused ? '自动刷新已暂停' : `每 ${refreshMs / 1000} 秒自动刷新` }}
        <template v-if="lastUpdated">
          · 最近更新 {{ new Date(lastUpdated).toLocaleTimeString('zh-CN') }}
        </template>
      </p>
      <NTag
        v-if="paused"
        size="tiny"
        :bordered="false"
        type="warning"
        class="ml-auto"
      >
        已暂停
      </NTag>
    </section>

    <!-- 内容区：relative 定高，加载遮罩才能在可视范围内垂直水平居中 -->
    <div class="relative flex-1 min-h-0">
      <div class="h-full overflow-y-auto pr-1">
        <ErrorState v-if="!data && error" :message="error" @retry="load()" />

        <EmptyState
          v-else-if="!loading && !data"
          :icon="SpeedometerOutline"
          title="暂无系统指标"
          description="后端 /metrics 返回空数据，请确认服务已启动并完成登录鉴权。"
        >
          <NButton size="small" type="primary" @click="load()"
            >重新获取</NButton
          >
        </EmptyState>

        <div v-else-if="data" class="flex flex-col gap-3">
          <div
            v-if="error"
            class="glass-panel border-l-4 border-l-red-500 px-4 py-2 flex items-center gap-2 text-12px"
          >
            <NIcon :size="15" class="text-red-500"
              ><AlertCircleOutline
            /></NIcon>
            <span class="text-ink-sub"
              >本次刷新失败：{{ error }}（下方展示的是上次成功的数据）</span
            >
          </div>

          <div class="metrics-strip">
            <StatCard
              label="健康状态"
              :value="healthy ? '正常' : '异常'"
              :hint="
                data.health.database.ok
                  ? 'health 段：数据库探测正常'
                  : 'health 段：数据库探测失败'
              "
              :icon="healthy ? CheckmarkCircleOutline : AlertCircleOutline"
            />
            <StatCard
              label="运行时长"
              :value="formatUptime(data.uptime)"
              hint="自进程启动至今"
              :icon="TimeOutline"
            />
            <StatCard
              label="内存 RSS"
              :value="formatBytes(data.memory.rss)"
              :hint="`堆已用 ${heapPercent}%`"
              :icon="HardwareChipOutline"
            />
            <StatCard
              :label="`QPS（近 ${data.qps.windowSeconds} 秒）`"
              :value="data.qps.perSecond.toFixed(2)"
              :hint="`窗口内 ${data.qps.requests} 次请求`"
              :icon="PulseOutline"
            />
            <StatCard
              label="存储用量"
              :value="formatBytesOrDash(data.storage.totalSize)"
              :hint="`${data.storage.fileCount.toLocaleString()} 个文件 · ${rootItems.length} 个根目录`"
              :icon="SaveOutline"
            />
            <StatCard
              label="数据库"
              :value="data.health.database.ok ? '已连接' : '不可用'"
              :hint="`数据库文件 ${formatBytesOrDash(data.health.database.sizeBytes)}`"
              :icon="ServerOutline"
            />
            <StatCard
              label="活跃分享"
              :value="data.shares.active.toLocaleString()"
              :hint="`共 ${data.shares.total} · 已过期 ${data.shares.expired}`"
              :icon="ShareSocialOutline"
            />
            <StatCard
              label="应用版本"
              :value="data.apps.published.toLocaleString()"
              :hint="`灰度 ${data.apps.gray} · 草稿 ${data.apps.draft} · 下架 ${data.apps.offline}`"
              :icon="RocketOutline"
            />
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <!-- 内存 -->
            <section class="glass-panel px-5 py-4 flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <h2 class="m-0 text-13px font-600 text-ink">内存占用</h2>
                <span class="ml-auto text-11px text-ink-sub">
                  heapUsed / heapTotal {{ heapPercent }}%
                </span>
              </div>
              <BarList
                :items="memoryItems"
                :value-formatter="formatBytes"
                :max="data.memory.rss"
              />
              <div
                class="h-2 rounded-full bg-ink-sub/10 dark:bg-ink-dark-sub/15 overflow-hidden"
              >
                <div
                  class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-all duration-500"
                  :style="{ width: `${heapPercent}%` }"
                />
              </div>
              <p class="m-0 text-10px text-ink-sub">
                数据来自
                process.memoryUsage()，用于观察进程内存趋势，非系统总内存占用。
              </p>
            </section>

            <!-- 24h 升级事件 -->
            <section class="glass-panel px-5 py-4 flex flex-col gap-3">
              <div class="flex items-center gap-2">
                <h2 class="m-0 text-13px font-600 text-ink">
                  最近 24 小时升级事件
                </h2>
                <span class="ml-auto text-11px text-ink-sub">
                  共 {{ upgradeEventTotal.toLocaleString() }} 次
                  <template v-if="upgradeEventMissingCount > 0">
                    · {{ upgradeEventMissingCount }} 类无数据
                  </template>
                </span>
              </div>
              <BarList
                v-if="upgradeEventItems.length > 0"
                :items="upgradeEventItems"
              />
              <div
                v-else
                class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-6 text-center text-12px text-ink-sub"
              >
                最近 24 小时没有客户端上报升级事件（无数据的事件类型由后端返回
                null）
              </div>
            </section>
          </div>

          <!-- 根目录 -->
          <section class="glass-panel px-5 py-4 flex flex-col gap-3">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="m-0 text-13px font-600 text-ink">资源根目录用量</h2>
              <span class="ml-auto text-11px text-ink-sub">
                最大：{{
                  largestRoot
                    ? `${largestRoot.name} · ${formatBytesOrDash(largestRoot.totalSize)}`
                    : '—'
                }}
              </span>
            </div>
            <div
              v-if="rootItems.length === 0"
              class="py-6 text-center text-12px text-ink-sub"
            >
              暂无资源根目录
            </div>
            <div v-else class="overflow-x-auto">
              <table
                class="app-table w-full min-w-600px border-collapse text-12px"
              >
                <thead>
                  <tr class="text-left text-11px text-ink-sub">
                    <th class="py-2 pr-3 font-500">根目录</th>
                    <th class="py-2 px-2 font-500 w-32">标识</th>
                    <th class="py-2 px-2 font-500 text-right w-28">文件数</th>
                    <th class="py-2 px-2 font-500 text-right w-32">占用</th>
                    <th class="py-2 pl-2 font-500 w-40">占总存储</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="root in rootItems"
                    :key="root.rootId"
                    class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
                  >
                    <td
                      class="py-2 pr-3 text-ink truncate max-w-240px"
                      :title="root.name"
                    >
                      {{ root.name }}
                    </td>
                    <td
                      class="py-2 px-2 text-ink-sub font-mono text-11px whitespace-nowrap"
                    >
                      {{ root.rootId }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ root.fileCount.toLocaleString() }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ formatBytesOrDash(root.totalSize) }}
                    </td>
                    <td class="py-2 pl-2">
                      <div class="flex items-center gap-2">
                        <div
                          class="flex-1 h-1.5 rounded-full bg-ink-sub/10 dark:bg-ink-dark-sub/15 overflow-hidden"
                        >
                          <div
                            class="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400"
                            :style="{
                              width: `${rootShare(root.totalSize) ?? 0}%`,
                            }"
                          />
                        </div>
                        <span
                          class="text-11px text-ink-sub tabular-nums w-12 text-right"
                        >
                          {{ rootShareLabel(root.totalSize) }}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <p class="m-0 text-10px text-ink-sub">
            说明：health
            段由后端独立返回数据库可达性与数据库文件大小（未落盘或不可读时为
            null）；存储用量只统计文件库索引内的文件，无索引数据时显示「—」。
          </p>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>
  </div>
</template>
