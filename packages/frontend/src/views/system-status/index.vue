<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  NCard,
  NGrid,
  NGridItem,
  NStatistic,
  NTag,
  NIcon,
  NSpin,
  NSwitch,
  NButton,
  NEmpty,
  useMessage,
} from 'naive-ui';
import {
  RefreshOutline,
  SpeedometerOutline,
  TimeOutline,
  PeopleOutline,
  ServerOutline,
  CloudUploadOutline,
  LinkOutline,
  PhonePortraitOutline,
  PulseOutline,
} from '@vicons/ionicons5';
import { getSystemMetrics, type SystemMetrics } from '@/api/system';
import { getErrorMessage } from '@/utils/request';
import { formatSize } from '@/utils/format';

defineOptions({
  name: 'system-status',
});

const message = useMessage();
const loading = ref(false);
const metrics = ref<SystemMetrics | null>(null);
const autoRefresh = ref(false);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** 自动刷新间隔（毫秒） */
const REFRESH_INTERVAL_MS = 30_000;

/** 秒数格式化为「x天 x小时 x分 x秒」 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} 天`);
  if (hours > 0) parts.push(`${hours} 小时`);
  if (minutes > 0) parts.push(`${minutes} 分`);
  parts.push(`${secs} 秒`);
  return parts.join(' ');
}

/** 堆内存使用率 */
const heapUsagePercent = computed(() => {
  if (!metrics.value || metrics.value.memory.heapTotal <= 0) return 0;
  return (
    Math.round(
      (metrics.value.memory.heapUsed / metrics.value.memory.heapTotal) * 1000,
    ) / 10
  );
});

/** 升级事件固定展示顺序与中文标签 */
const upgradeEventLabels: { key: string; label: string }[] = [
  { key: 'check', label: '检查更新' },
  { key: 'download', label: '下载' },
  { key: 'install_success', label: '安装成功' },
  { key: 'install_fail', label: '安装失败' },
];

const upgradeEventList = computed(() =>
  upgradeEventLabels.map((item) => ({
    ...item,
    count: metrics.value?.upgradeEvents24h[item.key] ?? 0,
  })),
);

async function loadMetrics() {
  loading.value = true;
  try {
    metrics.value = await getSystemMetrics();
  } catch (error) {
    message.error(getErrorMessage(error, '加载系统指标失败'));
  } finally {
    loading.value = false;
  }
}

function handleAutoRefreshChange(value: boolean) {
  if (value) {
    refreshTimer = setInterval(loadMetrics, REFRESH_INTERVAL_MS);
  } else if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

onMounted(loadMetrics);
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <main class="px-4 md:px-6 pb-4">
    <div
      class="flex items-center justify-between py-4 mb-4 sticky top-0 z-2 bg-container/95 backdrop-blur border-b border-base shadow-sm -mx-4 md:-mx-6 px-4 md:px-6"
    >
      <div class="flex items-center gap-2">
        <NIcon size="22" class="text-primary">
          <SpeedometerOutline />
        </NIcon>
        <h2 class="text-xl font-semibold text-base">系统状态</h2>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 text-sm text-gray-500">
          <span>30 秒自动刷新</span>
          <NSwitch
            size="small"
            :value="autoRefresh"
            @update:value="handleAutoRefreshChange"
          />
        </div>
        <NButton
          quaternary
          circle
          title="刷新"
          :loading="loading"
          @click="loadMetrics"
        >
          <template #icon>
            <NIcon><RefreshOutline /></NIcon>
          </template>
        </NButton>
      </div>
    </div>

    <NSpin :show="loading">
      <div v-if="metrics" class="flex flex-col gap-4">
        <!-- 运行状态概览 -->
        <NGrid cols="1 s:3" :x-gap="12" :y-gap="12" responsive="screen">
          <NGridItem>
            <NCard size="small">
              <div class="flex items-start gap-3">
                <NIcon size="28" class="text-primary mt-1">
                  <TimeOutline />
                </NIcon>
                <div class="min-w-0">
                  <div class="text-sm text-gray-500">运行时长</div>
                  <div class="text-lg font-semibold truncate">
                    {{ formatUptime(metrics.uptime) }}
                  </div>
                </div>
              </div>
            </NCard>
          </NGridItem>
          <NGridItem>
            <NCard size="small">
              <div class="flex items-start gap-3">
                <NIcon size="28" class="text-primary mt-1">
                  <PulseOutline />
                </NIcon>
                <div class="min-w-0">
                  <div class="text-sm text-gray-500">
                    QPS（最近 {{ metrics.qps.windowSeconds }} 秒）
                  </div>
                  <div class="text-lg font-semibold">
                    {{ metrics.qps.perSecond }}
                    <span class="text-xs text-gray-500 font-normal">
                      / 秒 · {{ metrics.qps.requests }} 次请求
                    </span>
                  </div>
                </div>
              </div>
            </NCard>
          </NGridItem>
          <NGridItem>
            <NCard size="small">
              <div class="flex items-start gap-3">
                <NIcon size="28" class="text-primary mt-1">
                  <PeopleOutline />
                </NIcon>
                <div class="min-w-0">
                  <div class="text-sm text-gray-500">注册用户</div>
                  <div class="text-lg font-semibold">
                    {{ metrics.users }}
                    <span class="text-xs text-gray-500 font-normal">人</span>
                  </div>
                </div>
              </div>
            </NCard>
          </NGridItem>
        </NGrid>

        <!-- 内存与存储 -->
        <NGrid :cols="2" :x-gap="12" :y-gap="12" responsive="screen">
          <NGridItem>
            <NCard size="small">
              <template #header>
                <div class="flex items-center gap-2">
                  <NIcon><ServerOutline /></NIcon>
                  <span>进程内存</span>
                </div>
              </template>
              <div class="flex flex-col gap-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-gray-500">RSS（常驻内存）</span>
                  <span class="font-medium">{{
                    formatSize(metrics.memory.rss)
                  }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">堆已用 / 堆总量</span>
                  <span class="font-medium">
                    {{ formatSize(metrics.memory.heapUsed) }}
                    / {{ formatSize(metrics.memory.heapTotal) }}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">堆使用率</span>
                  <NTag
                    size="small"
                    :type="heapUsagePercent > 85 ? 'error' : 'success'"
                    :bordered="false"
                  >
                    {{ heapUsagePercent }}%
                  </NTag>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">External（C++ 对象/Buffer）</span>
                  <span class="font-medium">{{
                    formatSize(metrics.memory.external)
                  }}</span>
                </div>
              </div>
            </NCard>
          </NGridItem>
          <NGridItem>
            <NCard size="small">
              <template #header>
                <div class="flex items-center gap-2">
                  <NIcon><CloudUploadOutline /></NIcon>
                  <span>文件存储</span>
                </div>
              </template>
              <NStatistic label="总占用空间">
                {{ formatSize(metrics.storage.totalSize) }}
              </NStatistic>
              <div class="mt-2 text-sm text-gray-500">
                索引文件总数：{{ metrics.storage.fileCount }}
              </div>
            </NCard>
          </NGridItem>
        </NGrid>

        <!-- 各资源根用量 -->
        <NCard size="small" title="资源根用量">
          <div v-if="metrics.roots.length > 0" class="flex flex-col gap-2">
            <div
              v-for="root in metrics.roots"
              :key="root.rootId"
              class="flex items-center justify-between text-sm py-1 border-b border-base last:border-b-0"
            >
              <span class="font-medium">{{ root.name }}</span>
              <span class="text-gray-500">
                {{ formatSize(root.totalSize) }} · {{ root.fileCount }} 个文件
              </span>
            </div>
          </div>
          <NEmpty v-else description="暂无资源根" size="small" class="py-4" />
        </NCard>

        <!-- 分享与应用版本 -->
        <NGrid :cols="2" :x-gap="12" :y-gap="12" responsive="screen">
          <NGridItem>
            <NCard size="small">
              <template #header>
                <div class="flex items-center gap-2">
                  <NIcon><LinkOutline /></NIcon>
                  <span>分享链接</span>
                </div>
              </template>
              <div class="flex items-center gap-6">
                <NStatistic label="总数" :value="metrics.shares.total" />
                <NStatistic label="活跃中" :value="metrics.shares.active" />
                <NStatistic label="已失效" :value="metrics.shares.expired" />
              </div>
            </NCard>
          </NGridItem>
          <NGridItem>
            <NCard size="small">
              <template #header>
                <div class="flex items-center gap-2">
                  <NIcon><PhonePortraitOutline /></NIcon>
                  <span>APP 版本分布</span>
                </div>
              </template>
              <div class="flex flex-col gap-1.5 text-sm">
                <div class="flex justify-between">
                  <span class="text-gray-500">版本总数</span>
                  <span class="font-medium">{{ metrics.apps.total }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">全量发布</span>
                  <span class="font-medium">{{ metrics.apps.published }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">灰度中</span>
                  <span class="font-medium">{{ metrics.apps.gray }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">草稿</span>
                  <span class="font-medium">{{ metrics.apps.draft }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-gray-500">已下架</span>
                  <span class="font-medium">{{ metrics.apps.offline }}</span>
                </div>
              </div>
            </NCard>
          </NGridItem>
        </NGrid>

        <!-- 24 小时升级事件 -->
        <NCard size="small" title="最近 24 小时升级事件">
          <div class="flex flex-wrap gap-3">
            <NTag
              v-for="event in upgradeEventList"
              :key="event.key"
              size="large"
              :type="
                event.key === 'install_fail' && event.count > 0
                  ? 'error'
                  : 'default'
              "
              class="!px-3"
            >
              {{ event.label }}：{{ event.count }}
            </NTag>
          </div>
        </NCard>
      </div>
      <NEmpty v-else-if="!loading" description="暂无指标数据" class="py-16" />
    </NSpin>
  </main>
</template>
