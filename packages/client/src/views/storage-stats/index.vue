<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NButton, NIcon, NPopconfirm, NTag, useMessage } from 'naive-ui';
import {
  AlbumsOutline,
  FolderOpenOutline,
  PieChartOutline,
  RefreshOutline,
  SyncOutline,
} from '@vicons/ionicons5';
import type { RootIndexStatus, UsageStatsResult } from '@vakao/shared';
import { getUsageStats, syncFileIndex } from '@/api/files';
import { getRootIndexStatus } from '@/api/roots';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import { percentOf } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import StatCard from '@/components/common/stat-card.vue';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';
import DonutChart from '@/components/charts/donut-chart.vue';
import BarList from '@/components/charts/bar-list.vue';

/** 存储统计：按根目录与分类的容量、占比与文件数 */
const message = useMessage();
const data = ref<UsageStatsResult | null>(null);
const syncing = ref(false);
/** 加载态与中文提示：文案规则见 useListLoading */
const { loading, loadingText, begin: beginLoading } = useListLoading();
const error = ref('');

/** 刷新统计前清空旧数据，避免遮罩下残留上一轮的数字 */
function clearStats() {
  data.value = null;
}

async function load() {
  beginLoading(clearStats);
  error.value = '';
  try {
    data.value = await getUsageStats();
  } catch (e) {
    error.value = getErrorMessage(e, '存储统计加载失败');
    data.value = null;
  } finally {
    loading.value = false;
  }
}

const REBUILD_POLL_MS = 500;
const REBUILD_TIMEOUT_MS = 120_000;

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} 毫秒`;
  return `${(ms / 1000).toFixed(1)} 秒`;
}

/**
 * 等待本次重建结束：入队响应带回的是入队前的状态，
 * 以它的完成时间为基线，等到出现更新的完成记录才返回。
 */
async function waitRebuild(targets: RootIndexStatus[]) {
  const baseline = new Map(targets.map((item) => [item.rootId, item.finishedAt]));
  const deadline = Date.now() + REBUILD_TIMEOUT_MS;
  let latest = targets;
  while (Date.now() < deadline) {
    await wait(REBUILD_POLL_MS);
    latest = await getRootIndexStatus();
    const pending = latest.some((item) => {
      if (!baseline.has(item.rootId)) return false;
      if (item.state === 'running') return true;
      return item.finishedAt <= (baseline.get(item.rootId) ?? 0);
    });
    if (!pending) return latest;
  }
  return null;
}

/** 入队重建并等待本次扫描结束，按结果给出带文件数与耗时的提示 */
async function rebuildIndex() {
  syncing.value = true;
  try {
    const result = await syncFileIndex();
    if (result.status.length === 0) {
      message.warning('没有可重建的资源目录');
      return;
    }
    const latest = await waitRebuild(result.status);
    if (!latest) {
      message.warning('重建仍在进行，请稍后刷新查看');
      return;
    }
    const ids = new Set(result.status.map((item) => item.rootId));
    const finished = latest.filter((item) => ids.has(item.rootId));
    const failed = finished.find((item) => item.state === 'failed');
    if (failed) {
      message.error(`重建失败：${failed.error || '未知原因'}`);
      return;
    }
    const files = finished.reduce((sum, item) => sum + item.indexedFiles, 0);
    const duration = finished.reduce((sum, item) => sum + item.durationMs, 0);
    message.success(
      `重建完成 · ${files} 个文件 · ${formatDuration(duration)}`,
    );
    await load();
  } catch (e) {
    message.error(getErrorMessage(e, '重建索引失败'));
  } finally {
    syncing.value = false;
  }
}

const roots = computed(() => data.value?.roots ?? []);

const rootSegments = computed(() =>
  roots.value
    .filter((root) => root.totalSize > 0)
    .map((root) => ({ label: root.rootName, value: root.totalSize })),
);

const totalCategories = computed(() =>
  roots.value.reduce((total, root) => total + root.categories.length, 0),
);

const largestRoot = computed(() => {
  const sorted = [...roots.value].sort((a, b) => b.totalSize - a.totalSize);
  return sorted[0];
});

function categorySegments(
  categories: { category: string; totalSize: number }[],
) {
  return categories
    .filter((category) => category.totalSize > 0)
    .map((category) => ({
      label: category.category,
      value: category.totalSize,
    }));
}

onMounted(() => void load());
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4 animate-fade-up">
    <PageHeader
      title="存储统计"
      description="按资源根目录与分类统计容量占用、占比与文件数（GET /files/stats/usage）"
      :icon="PieChartOutline"
    >
      <template #actions>
        <NPopconfirm @positive-click="rebuildIndex">
          <template #trigger>
            <NButton size="small" quaternary :loading="syncing">
              <template #icon
                ><NIcon><SyncOutline /></NIcon>
              </template>
              重建索引
            </NButton>
          </template>
          重新扫描磁盘并刷新文件索引，文件较多时可能耗时，确认继续？
        </NPopconfirm>
        <NButton size="small" quaternary @click="load">
          <template #icon
            ><NIcon><RefreshOutline /></NIcon
          ></template>
          刷新
        </NButton>
      </template>
    </PageHeader>

    <div class="relative flex-1 min-h-0">
      <div class="h-full overflow-y-auto pr-1">
        <ErrorState v-if="error" :message="error" @retry="load" />

        <EmptyState
          v-else-if="!loading && roots.length === 0"
          :icon="AlbumsOutline"
          title="还没有可统计的资源"
          description="资源根目录为空，上传文件后这里会显示各根目录与分类的容量占用。"
        >
          <NButton size="small" type="primary" @click="load">重新统计</NButton>
        </EmptyState>

        <div v-else-if="data" class="flex flex-col gap-4">
          <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="总占用"
              :value="formatBytes(data.totalSize)"
              :icon="PieChartOutline"
            />
            <StatCard
              label="文件总数"
              :value="data.fileCount.toLocaleString()"
              :icon="AlbumsOutline"
            />
            <StatCard
              label="资源根目录"
              :value="String(roots.length)"
              :hint="`${totalCategories} 个分类`"
              :icon="FolderOpenOutline"
            />
            <StatCard
              label="最大根目录"
              :value="largestRoot?.rootName ?? '—'"
              :hint="
                largestRoot ? formatBytes(largestRoot.totalSize) : undefined
              "
              :icon="FolderOpenOutline"
            />
          </div>

          <!-- 根目录占比 -->
          <section class="glass-panel px-5 py-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <h2 class="m-0 text-13px font-600 text-ink">根目录占用占比</h2>
              <span class="ml-auto text-11px text-ink-sub"
                >总计 {{ formatBytes(data.totalSize) }}</span
              >
            </div>
            <DonutChart
              :segments="rootSegments"
              center-label="总占用"
              :center-value="formatBytes(data.totalSize)"
            />
          </section>

          <!-- 每个根目录的明细 -->
          <section
            v-for="root in roots"
            :key="root.rootId"
            class="glass-panel px-5 py-4 flex flex-col gap-4"
          >
            <div class="flex items-center gap-3 flex-wrap">
              <div
                class="glass-chip w-9 h-9 flex items-center justify-center shrink-0"
              >
                <NIcon :size="18" class="text-brand-600 dark:text-brand-400"
                  ><FolderOpenOutline
                /></NIcon>
              </div>
              <div class="min-w-0">
                <p class="m-0 text-13px font-600 text-ink">
                  {{ root.rootName }}
                </p>
                <p class="m-0 text-11px text-ink-sub font-mono">
                  {{ root.rootId }}
                </p>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <NTag size="small" :bordered="false"
                  >{{ root.fileCount.toLocaleString() }} 个文件</NTag
                >
                <NTag size="small" :bordered="false" type="info">{{
                  formatBytes(root.totalSize)
                }}</NTag>
              </div>
            </div>

            <div
              v-if="root.categories.length === 0"
              class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-6 text-center text-12px text-ink-sub"
            >
              该根目录下还没有分类
            </div>

            <div v-else class="grid gap-4 lg:grid-cols-2">
              <DonutChart
                :segments="categorySegments(root.categories)"
                center-label="根目录占用"
                :center-value="formatBytes(root.totalSize)"
                :size="120"
              />
              <BarList
                :items="
                  root.categories.map((category) => ({
                    label: category.category,
                    value: category.totalSize,
                    hint: `${category.fileCount} 个文件`,
                  }))
                "
                :value-formatter="formatBytes"
              />
            </div>

            <div v-if="root.categories.length > 0" class="overflow-x-auto">
              <table
                class="app-table w-full min-w-520px border-collapse text-12px"
              >
                <thead>
                  <tr class="text-left text-11px text-ink-sub">
                    <th class="py-2 pr-3 font-500">分类</th>
                    <th class="py-2 px-2 font-500 text-right">文件数</th>
                    <th class="py-2 px-2 font-500 text-right">占用</th>
                    <th class="py-2 pl-2 font-500 text-right">占根目录比例</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="category in root.categories"
                    :key="category.category"
                    class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
                  >
                    <td
                      class="py-2 pr-3 text-ink truncate max-w-240px"
                      :title="category.category"
                    >
                      {{ category.category }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ category.fileCount.toLocaleString() }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ formatBytes(category.totalSize) }}
                    </td>
                    <td class="py-2 pl-2 text-right tabular-nums">
                      {{ percentOf(category.totalSize, root.totalSize) }}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <p class="m-0 text-10px text-ink-sub flex items-center gap-1">
            <NIcon :size="12"><PieChartOutline /></NIcon>
            统计口径：仅统计文件库索引内的文件；空文件（0
            B）不参与占比图但计入文件数。
          </p>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>
  </div>
</template>
