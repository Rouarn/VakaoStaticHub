<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  NButton,
  NDatePicker,
  NIcon,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui';
import {
  DownloadOutline,
  FunnelOutline,
  InformationCircleOutline,
  RefreshOutline,
  RocketOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import { listApps, getFunnelStats } from '@/api/app-update';
import type { FunnelStatItem } from '@vakao/shared';
import { getErrorMessage } from '@/utils/http';
import { formatDate } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import StatCard from '@/components/common/stat-card.vue';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';

/**
 * 升级漏斗统计
 *
 * 后端不支持按版本筛选（只有 appKey + 时间范围），版本维度在下方明细表内展示。
 */
const message = useMessage();

const apps = ref<string[]>([]);
const appKey = ref('');
const range = ref<[number, number] | null>(null);
const data = ref<{ items: FunnelStatItem[]; checkNoUpdateTotal: number }>({
  items: [],
  checkNoUpdateTotal: 0,
});
/** 加载态与中文提示：文案规则见 useListLoading */
const { loading, loadingText, begin: beginLoading } = useListLoading();
const error = ref('');

const presets = [
  { label: '最近 7 天', days: 7 },
  { label: '最近 30 天', days: 30 },
  { label: '最近 90 天', days: 90 },
];

function applyPreset(days: number) {
  const end = Date.now();
  range.value = [end - days * 86_400_000, end];
  void load();
}

async function loadApps() {
  try {
    apps.value = await listApps();
    if (!appKey.value && apps.value.length > 0) appKey.value = apps.value[0];
  } catch (e) {
    message.error(getErrorMessage(e, '应用列表加载失败'));
  }
}

/** 切换应用 / 时间范围前清空旧统计，避免遮罩下残留上一次的数字 */
function clearStats() {
  data.value = { items: [], checkNoUpdateTotal: 0 };
}

async function load() {
  if (!appKey.value) {
    clearStats();
    return;
  }
  beginLoading(clearStats);
  error.value = '';
  try {
    const [startTime, endTime] = range.value ?? [];
    data.value = await getFunnelStats(appKey.value, startTime, endTime);
  } catch (e) {
    error.value = getErrorMessage(e, '漏斗统计加载失败');
    clearStats();
  } finally {
    loading.value = false;
  }
}

const sum = (key: keyof FunnelStatItem) =>
  data.value.items.reduce((total, item) => {
    const value = item[key];
    return total + (typeof value === 'number' ? value : 0);
  }, 0);

const totals = computed(() => ({
  promptShow: sum('promptShow'),
  downloadStart: sum('downloadStart'),
  downloadSuccess: sum('downloadSuccess'),
  installSuccess: sum('installSuccess'),
  downloadFail: sum('downloadFail'),
  installFail: sum('installFail'),
  verifyFail: sum('verifyFail'),
}));

const stages = computed(() => {
  const t = totals.value;
  return [
    { label: '更新提示展示', value: t.promptShow, rate: 100 },
    {
      label: '开始下载',
      value: t.downloadStart,
      rate: t.promptShow
        ? Math.round((t.downloadStart / t.promptShow) * 1000) / 10
        : 0,
    },
    {
      label: '下载成功',
      value: t.downloadSuccess,
      rate: t.downloadStart
        ? Math.round((t.downloadSuccess / t.downloadStart) * 1000) / 10
        : 0,
    },
    {
      label: '安装成功',
      value: t.installSuccess,
      rate: t.promptShow
        ? Math.round((t.installSuccess / t.promptShow) * 1000) / 10
        : 0,
    },
  ];
});

const maxStage = computed(() =>
  Math.max(1, ...stages.value.map((s) => s.value)),
);

const totalChecks = computed(
  () => data.value.checkNoUpdateTotal + totals.value.promptShow,
);

function rateLabel(value: string) {
  return value || '0%';
}

onMounted(async () => {
  await loadApps();
  applyPreset(30);
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4">
    <PageHeader
      title="升级漏斗"
      description="按应用与时间范围统计 check → 下载 → 安装的转化情况"
      :icon="FunnelOutline"
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

    <section
      class="glass-panel shrink-0 px-4 py-3 flex flex-wrap items-end gap-3"
    >
      <label class="flex flex-col gap-1">
        <span class="text-11px text-ink-sub">应用</span>
        <NSelect
          v-model:value="appKey"
          size="small"
          class="w-40"
          :options="apps.map((a) => ({ label: a, value: a }))"
          placeholder="选择应用"
          @update:value="load"
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-11px text-ink-sub">时间范围</span>
        <NDatePicker
          v-model:value="range"
          type="daterange"
          size="small"
          clearable
          class="w-64"
          @update:value="load"
        />
      </label>
      <div class="flex items-center gap-1 flex-wrap">
        <NButton
          v-for="preset in presets"
          :key="preset.days"
          size="tiny"
          quaternary
          @click="applyPreset(preset.days)"
        >
          {{ preset.label }}
        </NButton>
      </div>
      <span
        class="ml-auto text-11px text-ink-sub inline-flex items-center gap-1"
      >
        <NIcon :size="12"><InformationCircleOutline /></NIcon>
        后端仅支持 appKey + 时间范围，版本维度见下方明细
      </span>
    </section>

    <div class="relative flex-1 min-h-0">
      <div class="h-full overflow-y-auto pr-1">
        <ErrorState v-if="error" :message="error" @retry="load" />

        <EmptyState
          v-else-if="!loading && (!appKey || data.items.length === 0)"
          :icon="FunnelOutline"
          :title="!appKey ? '请选择一个应用' : '所选范围没有升级事件'"
          :description="
            !appKey
              ? '创建应用并发布版本后，客户端上报的升级事件会在这里形成漏斗。'
              : '换一个时间范围，或确认客户端已上报 check / download / install 事件。'
          "
        >
          <NButton v-if="!appKey" size="small" @click="loadApps"
            >刷新应用列表</NButton
          >
          <NButton v-else size="small" @click="applyPreset(90)"
            >扩大到 90 天</NButton
          >
        </EmptyState>

        <div v-else class="flex flex-col gap-4">
          <!-- 指标卡 -->
          <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="检查请求"
              :value="totalChecks.toLocaleString()"
              :hint="`无更新 ${data.checkNoUpdateTotal.toLocaleString()} 次`"
              :icon="TimeOutline"
            />
            <StatCard
              label="下载开始"
              :value="totals.downloadStart.toLocaleString()"
              :hint="`失败 ${totals.downloadFail} 次`"
              :icon="DownloadOutline"
            />
            <StatCard
              label="下载成功"
              :value="totals.downloadSuccess.toLocaleString()"
              :hint="`校验失败 ${totals.verifyFail} 次`"
              :icon="DownloadOutline"
            />
            <StatCard
              label="安装成功"
              :value="totals.installSuccess.toLocaleString()"
              :hint="`安装失败 ${totals.installFail} 次`"
              :icon="RocketOutline"
            />
          </div>

          <!-- 漏斗图 -->
          <section class="glass-panel px-5 py-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <h2 class="m-0 text-13px font-600 text-ink">转化漏斗</h2>
              <NTag v-if="range" size="tiny" :bordered="false">
                {{ formatDate(range[0]) }} ~ {{ formatDate(range[1]) }}
              </NTag>
              <span class="ml-auto text-11px text-ink-sub"
                >整体安装转化 {{ stages[3].rate }}%</span
              >
            </div>

            <div class="flex flex-col gap-3">
              <div
                v-for="(stage, index) in stages"
                :key="stage.label"
                class="flex flex-col gap-1"
              >
                <div class="flex items-baseline gap-2 text-12px">
                  <span class="text-ink font-600">{{ stage.label }}</span>
                  <span class="text-ink-sub tabular-nums">{{
                    stage.value.toLocaleString()
                  }}</span>
                  <span class="ml-auto text-11px text-ink-sub">
                    <template v-if="index === 0">基准</template>
                    <template v-else>
                      较上一阶段 {{ stage.rate }}%
                      <template v-if="stages[index - 1].value">
                        · 流失
                        {{
                          (
                            stages[index - 1].value - stage.value
                          ).toLocaleString()
                        }}
                      </template>
                    </template>
                  </span>
                </div>
                <div class="h-6 rounded-lg bg-ink-sub/10 overflow-hidden">
                  <div
                    class="h-full rounded-lg bg-gradient-to-r from-brand-700 via-brand-500 to-brand-300 transition-all duration-500 flex items-center px-2"
                    :style="{
                      width: `${Math.max(4, (stage.value / maxStage) * 100)}%`,
                    }"
                  >
                    <span
                      class="text-10px text-white tabular-nums whitespace-nowrap"
                    >
                      {{ stage.value.toLocaleString() }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 按版本明细 -->
          <section class="glass-panel px-4 py-3 flex flex-col gap-2">
            <h2 class="m-0 text-13px font-600 text-ink">按版本明细</h2>
            <div class="overflow-x-auto">
              <table
                class="app-table w-full min-w-760px border-collapse text-12px"
              >
                <thead>
                  <tr class="text-left text-11px text-ink-sub">
                    <th class="py-2 pr-3 font-500">版本</th>
                    <th class="py-2 px-2 font-500 text-right">提示展示</th>
                    <th class="py-2 px-2 font-500 text-right">下载开始</th>
                    <th class="py-2 px-2 font-500 text-right">下载成功</th>
                    <th class="py-2 px-2 font-500 text-right">安装成功</th>
                    <th class="py-2 px-2 font-500 text-right">下载率</th>
                    <th class="py-2 px-2 font-500 text-right">安装率</th>
                    <th class="py-2 pl-2 font-500 text-right">整体转化</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in data.items"
                    :key="item.toVersionCode"
                    class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
                  >
                    <td class="py-2 pr-3">
                      <span class="text-ink font-600"
                        >v{{ item.versionName }}</span
                      >
                      <span class="text-10px text-ink-sub ml-1"
                        >vc {{ item.toVersionCode }}</span
                      >
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ item.promptShow.toLocaleString() }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ item.downloadStart.toLocaleString() }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ item.downloadSuccess.toLocaleString() }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ item.installSuccess.toLocaleString() }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ rateLabel(item.downloadRate) }}
                    </td>
                    <td class="py-2 px-2 text-right tabular-nums">
                      {{ rateLabel(item.installRate) }}
                    </td>
                    <td
                      class="py-2 pl-2 text-right tabular-nums text-brand-600 dark:text-brand-400 font-600"
                    >
                      {{ rateLabel(item.overallRate) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="m-0 text-10px text-ink-sub">
              失败明细：下载失败 {{ totals.downloadFail }} · 校验失败
              {{ totals.verifyFail }} · 安装失败
              {{ totals.installFail }}；check_no_update 事件不计入漏斗阶段。
            </p>
          </section>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>
  </div>
</template>
