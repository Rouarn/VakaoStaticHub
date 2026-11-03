<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  NButton,
  NIcon,
  NInput,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpin,
  NTag,
  useMessage,
} from 'naive-ui';
import {
  ChatbubbleOutline,
  CopyOutline,
  LinkOutline,
  SendOutline,
  TimeOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  HitokotoErrorKind,
  HitokotoRequest,
  HitokotoResult,
} from '@/api/hitokoto';
import {
  HitokotoError,
  buildHitokotoUrl,
  requestHitokoto,
} from '@/api/hitokoto';
import { formatDateTime } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';

/**
 * 一言调试工具
 *
 * 后端反向代理 GET /static/hitokoto → HITOKOTO_API_URL，响应原样透传（不走信封）。
 * 未配置上游时后端返回 503 + HITOKOTO_PROXY_DISABLED，这里给出「代理未启用」的明确原因；
 * 上游不可达时返回 502，同样展示具体原因而不是「请求失败」。
 */
const message = useMessage();

const CATEGORY_OPTIONS = [
  { label: '动画', value: 'a' },
  { label: '漫画', value: 'b' },
  { label: '游戏', value: 'c' },
  { label: '文学', value: 'd' },
  { label: '原创', value: 'e' },
  { label: '来自网络', value: 'f' },
  { label: '其他', value: 'g' },
  { label: '影视', value: 'h' },
  { label: '诗词', value: 'i' },
  { label: '网易云', value: 'j' },
  { label: '哲学', value: 'k' },
  { label: '抖机灵', value: 'l' },
];

const STORAGE_KEY = 'vakao.hitokoto.history.v1';

interface HistoryItem {
  text: string;
  from?: string;
  fromWho?: string | null;
  type?: string;
  at: number;
  url: string;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

const categories = ref<string[]>([]);
const encode = ref<'json' | 'text'>('json');
const loading = ref(false);
const error = ref('');
const errorKind = ref<HitokotoErrorKind | null>(null);
const result = ref<HitokotoResult | null>(null);
const rawText = ref('');
const history = ref<HistoryItem[]>(loadHistory());

const requestUrl = computed(() =>
  buildHitokotoUrl({
    categories: categories.value,
    encode: encode.value,
  } satisfies HitokotoRequest),
);

const displaySentence = computed(() =>
  encode.value === 'text' ? rawText.value : (result.value?.hitokoto ?? ''),
);

const displayFrom = computed(() => {
  if (encode.value === 'text' || !result.value) return '';
  const { from, from_who: fromWho } = result.value;
  if (from && fromWho) return `${fromWho} · ${from}`;
  return from ?? fromWho ?? '';
});

const ERROR_LABEL: Record<HitokotoErrorKind, string> = {
  'proxy-disabled': '代理未启用（503）',
  upstream: '上游服务不可用',
  network: '网络连接失败',
  format: '响应格式异常',
  http: '请求失败',
};

async function send() {
  loading.value = true;
  error.value = '';
  errorKind.value = null;
  try {
    const response = await requestHitokoto({
      categories: categories.value,
      encode: encode.value,
    });
    rawText.value = response.text;
    result.value = response.data;
    if (response.data) {
      pushHistory({
        text: response.data.hitokoto,
        from: response.data.from,
        fromWho: response.data.from_who,
        type: response.data.type,
        at: Date.now(),
        url: response.url,
      });
    } else {
      pushHistory({
        text: response.text.slice(0, 120),
        at: Date.now(),
        url: response.url,
      });
    }
    message.success('一言获取成功');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '一言请求失败';
    errorKind.value = e instanceof HitokotoError ? e.kind : null;
    result.value = null;
    rawText.value = '';
  } finally {
    loading.value = false;
  }
}

function pushHistory(item: HistoryItem) {
  history.value = [item, ...history.value].slice(0, 30);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.value));
  } catch {
    // localStorage 写入失败不影响主流程
  }
}

function clearHistory() {
  history.value = [];
  localStorage.removeItem(STORAGE_KEY);
  message.success('历史记录已清空');
}

async function copyText(text: string, tip = '已复制') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    message.success(tip);
  } catch {
    message.error('复制失败，请手动选择文本');
  }
}

const jsonPreview = computed(() => {
  if (!rawText.value) return '';
  try {
    return JSON.stringify(JSON.parse(rawText.value), null, 2);
  } catch {
    return rawText.value;
  }
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4 animate-fade-up">
    <PageHeader
      title="一言"
      description="调试分类与编码参数，查看原始响应与历史记录（后端反向代理 HITOKOTO_API_URL）"
      :icon="ChatbubbleOutline"
    >
      <template #actions>
        <NButton size="small" type="primary" :loading="loading" @click="send">
          <template #icon
            ><NIcon><SendOutline /></NIcon
          ></template>
          请求一言
        </NButton>
      </template>
    </PageHeader>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1">
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div class="flex flex-col gap-4 min-w-0">
        <!-- 参数面板 -->
        <section class="glass-panel px-4 py-4 flex flex-col gap-3">
          <h2 class="m-0 text-13px font-600 text-ink">参数调试</h2>
          <div class="flex flex-col gap-1">
            <label class="text-11px text-ink-sub"
              >分类（不选表示全部分类，参数 c=a|b|c）</label
            >
            <NSelect
              v-model:value="categories"
              multiple
              clearable
              size="small"
              :options="CATEGORY_OPTIONS"
              placeholder="全部分类"
            />
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <span class="text-11px text-ink-sub">返回编码（encode）</span>
            <NRadioGroup v-model:value="encode" size="small">
              <NRadioButton value="json">json（默认）</NRadioButton>
              <NRadioButton value="text">text（纯文本）</NRadioButton>
            </NRadioGroup>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-11px text-ink-sub">请求地址</label>
            <div class="flex items-center gap-2 min-w-0">
              <NIcon :size="14" class="text-ink-sub shrink-0"
                ><LinkOutline
              /></NIcon>
              <NInput
                :value="requestUrl"
                size="small"
                readonly
                class="font-mono"
              />
              <NButton
                size="small"
                quaternary
                @click="copyText(requestUrl, '请求地址已复制')"
              >
                <template #icon
                  ><NIcon><CopyOutline /></NIcon
                ></template>
              </NButton>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <NButton size="small" :loading="loading" @click="send"
              >请求一言</NButton
            >
            <NButton
              size="small"
              quaternary
              @click="copyText(requestUrl, '请求地址已复制')"
            >
              复制地址
            </NButton>
          </div>
        </section>

        <!-- 结果 -->
        <section class="glass-panel px-4 py-4 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <h2 class="m-0 text-13px font-600 text-ink">响应结果</h2>
            <NTag
              v-if="encode === 'json' && result"
              size="tiny"
              :bordered="false"
              type="info"
            >
              {{ result.type ?? '未标注类型' }}
            </NTag>
            <span class="ml-auto text-11px text-ink-sub"
              >原样透传，不走后端信封</span
            >
          </div>

          <NSpin :show="loading">
            <div
              v-if="error"
              class="rounded-xl border border-red-400/40 bg-red-500/5 px-4 py-4 flex flex-col gap-2"
            >
              <p class="m-0 text-13px font-600 text-ink">
                {{ errorKind ? ERROR_LABEL[errorKind] : '请求失败' }}
              </p>
              <p class="m-0 text-12px text-ink-sub whitespace-pre-line">
                {{ error }}
              </p>
              <div class="flex items-center gap-2">
                <NButton size="tiny" @click="send">重试</NButton>
                <span class="text-10px text-ink-sub">
                  {{
                    errorKind === 'proxy-disabled'
                      ? '后端未启用一言代理（503）：检查 HITOKOTO_API_URL 是否为空或被显式禁用'
                      : errorKind === 'network'
                        ? '网络问题：确认后端服务与网络连通，而非代理配置问题'
                        : '若持续失败，请确认后端代理目标可达'
                  }}
                </span>
              </div>
            </div>

            <div
              v-else-if="displaySentence || rawText"
              class="rounded-2xl bg-gradient-to-br from-brand-500/10 to-brand-300/10 dark:from-brand-700/20 dark:to-brand-900/20 px-6 py-6 flex flex-col gap-3"
            >
              <p class="m-0 text-18px leading-7 font-500 text-ink">
                {{ displaySentence }}
              </p>
              <div class="flex items-center gap-2 flex-wrap">
                <span v-if="displayFrom" class="text-12px text-ink-sub"
                  >—— {{ displayFrom }}</span
                >
                <NButton
                  size="tiny"
                  quaternary
                  class="ml-auto"
                  @click="copyText(displaySentence, '一言已复制')"
                >
                  <template #icon
                    ><NIcon><CopyOutline /></NIcon
                  ></template>
                  复制
                </NButton>
              </div>
            </div>

            <EmptyState
              v-else-if="!loading"
              flat
              :icon="ChatbubbleOutline"
              title="还没有请求结果"
              description="选择分类与编码后点击「请求一言」，响应会展示在这里并写入本地历史。"
            >
              <NButton size="small" type="primary" @click="send"
                >立即请求</NButton
              >
            </EmptyState>
          </NSpin>

          <div v-if="rawText" class="flex flex-col gap-1.5">
            <div class="flex items-center gap-2">
              <p class="m-0 text-12px font-600 text-ink">原始响应</p>
              <NButton
                size="tiny"
                quaternary
                class="ml-auto"
                @click="copyText(rawText, '原始响应已复制')"
              >
                复制原始响应
              </NButton>
            </div>
            <pre
              class="m-0 max-h-64 overflow-auto rounded-xl bg-black/4 dark:bg-black/30 border border-glass-border dark:border-glass-border-dark p-3 text-11px leading-5 text-ink-sub font-mono whitespace-pre-wrap break-all"
              >{{ jsonPreview }}</pre>
          </div>
        </section>
      </div>

      <!-- 历史记录 -->
      <section class="glass-panel px-4 py-4 flex flex-col gap-3 min-w-0">
        <div class="flex items-center gap-2">
          <h2 class="m-0 text-13px font-600 text-ink">历史记录</h2>
          <NTag size="tiny" :bordered="false">{{ history.length }}</NTag>
          <NButton
            v-if="history.length > 0"
            size="tiny"
            quaternary
            class="ml-auto"
            @click="clearHistory"
          >
            <template #icon
              ><NIcon><TrashOutline /></NIcon
            ></template>
            清空
          </NButton>
        </div>

        <div
          v-if="history.length === 0"
          class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-8 flex flex-col items-center gap-2 text-center"
        >
          <NIcon :size="22" class="text-ink-sub"><TimeOutline /></NIcon>
          <p class="m-0 text-12px text-ink-sub">
            请求过的一言会保存在本地，最多保留 30 条
          </p>
        </div>

        <ul
          v-else
          class="m-0 p-0 list-none flex flex-col gap-2 max-h-640px overflow-y-auto pr-1"
        >
          <li
            v-for="(item, index) in history"
            :key="`${item.at}-${index}`"
            class="glass-card px-3 py-2.5 flex flex-col gap-1 group"
          >
            <p class="m-0 text-12px text-ink leading-5">{{ item.text }}</p>
            <div
              class="flex items-center gap-2 text-10px text-ink-sub flex-wrap"
            >
              <span v-if="item.from || item.fromWho" class="truncate">
                —— {{ item.fromWho ? `${item.fromWho} · ` : '' }}{{ item.from }}
              </span>
              <span class="tabular-nums">{{ formatDateTime(item.at) }}</span>
              <NButton
                size="tiny"
                quaternary
                class="ml-auto"
                @click="copyText(item.text, '历史一言已复制')"
              >
                <template #icon
                  ><NIcon><CopyOutline /></NIcon
                ></template>
              </NButton>
            </div>
          </li>
        </ul>

        <p class="m-0 text-10px text-ink-sub">
          历史记录仅保存在当前浏览器 localStorage，不会上传服务器。
        </p>
      </section>
    </div>
    </div>
  </div>
</template>
