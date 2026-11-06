<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { NButton, NIcon, NInput, NModal, NPopover, NSpin } from 'naive-ui';
import {
  ArrowUpOutline,
  ChevronDownOutline,
  FolderOpenOutline,
  FolderOutline,
  HomeOutline,
  RefreshOutline,
  ServerOutline,
  ShieldCheckmarkOutline,
} from '@vicons/ionicons5';
import type {
  BrowseBound,
  BrowseDirectoriesResult,
  BrowseShortcut,
} from '@vakao/shared';
import { browseBounds, browseDirectories } from '@/api/roots';
import { getErrorMessage } from '@/utils/http';

/**
 * 服务器目录选择弹框
 *
 * - 数据来自 GET /roots/browse（仅目录，不返回文件）
 * - 可访问边界来自 GET /roots/browse/bounds，始终以快捷入口展示，
 *   避免「必须手输路径、输错后一片空白」的试错成本
 * - 地址栏可直接编辑，回车跳转；越界/不存在都会给出可读错误与回退入口
 * - 默认起点：优先「已配置根目录的父级」，其次白名单，最后用户主目录
 */
const props = defineProps<{
  show: boolean;
  /** 打开时优先浏览的路径；为空则从最合适的可访问边界开始 */
  initialPath?: string;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'select', path: string): void;
}>();

const loading = ref(false);
const error = ref('');
const result = ref<BrowseDirectoriesResult | null>(null);
const pathInput = ref('');

const bounds = ref<BrowseBound[]>([]);
const roots = ref<BrowseShortcut[]>([]);
const boundsLoading = ref(false);

const canGoUp = computed(() => !!result.value?.parent);

/** 默认起点：bounds 已按「根目录父级 → 白名单 → 主目录」排序 */
const preferredBound = computed<BrowseBound | undefined>(() => bounds.value[0]);

const boundLabel: Record<BrowseBound['source'], string> = {
  'root-parent': '根目录父级',
  whitelist: '白名单',
  home: '主目录',
};

/** 入口图标：一眼区分来源，比纯文字胶囊更好扫读 */
const boundIcon: Record<BrowseBound['source'], Component> = {
  'root-parent': FolderOutline,
  whitelist: ShieldCheckmarkOutline,
  home: HomeOutline,
};

/** 取路径末尾 n 段（用于生成短名，避免长路径把标签撑开） */
function lastSegments(path: string, count: number): string {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(-count).join('/');
}

type ChipSource = BrowseBound['source'] | 'root';

interface PickerEntry {
  path: string;
  /** 来源标签（根目录 / 根目录父级 / 白名单 / 主目录） */
  label: string;
  /** 展示短名：已配置根目录用其名称，边界用路径末段 */
  name: string;
  source: ChipSource;
}

/**
 * 快捷入口：先列已配置根目录（可直接跳转），再列允许边界。
 *
 * 边界只按「父级」去重，所以同一目录下新增多个根目录不会产生新边界；
 * 根目录本身单独返回，避免「加了根目录却看不到入口」。
 */
const entries = computed<PickerEntry[]>(() => {
  const seen = new Set<string>();
  const list: PickerEntry[] = [];

  for (const root of roots.value) {
    if (seen.has(root.path)) continue;
    seen.add(root.path);
    list.push({
      path: root.path,
      label: '根目录',
      name: root.label,
      source: 'root',
    });
  }

  const counts = new Map<string, number>();
  for (const bound of bounds.value) {
    const base = lastSegments(bound.path, 1);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  for (const bound of bounds.value) {
    if (seen.has(bound.path)) continue;
    seen.add(bound.path);
    const base = lastSegments(bound.path, 1);
    list.push({
      path: bound.path,
      label: boundLabel[bound.source],
      name:
        (counts.get(base) ?? 0) > 1
          ? lastSegments(bound.path, 2)
          : base || bound.path,
      source: bound.source,
    });
  }

  return list;
});

/** 行内最多展示的入口数，超出部分收进「更多」下拉，避免撑成多行 */
const INLINE_BOUND_LIMIT = 3;
const inlineChips = computed(() => entries.value.slice(0, INLINE_BOUND_LIMIT));
const overflowChips = computed(() => entries.value.slice(INLINE_BOUND_LIMIT));
const overflowShow = ref(false);

function entryIcon(source: ChipSource): Component {
  return source === 'root' ? FolderOpenOutline : boundIcon[source];
}

async function load(path?: string) {
  loading.value = true;
  error.value = '';
  const target = path?.trim();
  try {
    const data = await browseDirectories(target || undefined);
    result.value = data;
    pathInput.value = data.path;
  } catch (e) {
    // 保留上一次成功结果没有意义（路径已变），这里只保留可访问入口供跳回
    error.value = getErrorMessage(e, '目录加载失败');
  } finally {
    loading.value = false;
  }
}

function go() {
  const path = pathInput.value.trim();
  if (path) void load(path);
}

function enter(path: string) {
  void load(path);
}

function goUp() {
  if (result.value?.parent) void load(result.value.parent);
}

function goBound(entry: { path: string }) {
  overflowShow.value = false;
  void load(entry.path);
}

/** 出错后回到最合适的可访问目录 */
function backToAllowed() {
  const target = preferredBound.value?.path;
  if (target) void load(target);
}

function chooseCurrent() {
  if (!result.value || error.value) return;
  emit('select', result.value.path);
  emit('update:show', false);
}

function close() {
  emit('update:show', false);
}

async function loadBounds() {
  boundsLoading.value = true;
  try {
    const data = await browseBounds();
    bounds.value = data.bounds ?? [];
    roots.value = data.roots ?? [];
  } catch {
    // 边界接口失败不阻塞手输浏览
    bounds.value = [];
    roots.value = [];
  } finally {
    boundsLoading.value = false;
  }
}

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return;
    result.value = null;
    error.value = '';
    pathInput.value = props.initialPath?.trim() ?? '';
    await loadBounds();
    const start = pathInput.value || preferredBound.value?.path;
    if (start) await load(start);
    else await load();
  },
);
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="浏览服务器目录"
    style="width: 620px"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="flex flex-col gap-3">
      <!-- 可编辑地址栏：输入绝对路径后回车跳转 -->
      <div class="glass-panel px-3 py-2 flex items-center gap-2">
        <NIcon :size="15" class="shrink-0 text-brand-500">
          <ServerOutline />
        </NIcon>
        <NInput
          v-model:value="pathInput"
          size="small"
          placeholder="输入服务器绝对路径后回车"
          :disabled="loading"
          @keyup.enter="go"
        />
        <NButton size="tiny" quaternary :disabled="loading" @click="go">
          前往
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :disabled="!canGoUp || loading"
          @click="goUp"
        >
          <template #icon
            ><NIcon :size="14"><ArrowUpOutline /></NIcon
          ></template>
          上级
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :loading="loading"
          @click="load(result?.path)"
        >
          <template #icon
            ><NIcon :size="14"><RefreshOutline /></NIcon
          ></template>
        </NButton>
      </div>

      <!-- 可访问位置：点一下直达；图标 + 短名，完整路径见悬浮提示与地址栏 -->
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-11px text-ink-sub shrink-0">可访问位置</span>
        <template v-if="entries.length">
          <button
            v-for="bound in inlineChips"
            :key="bound.path"
            type="button"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-11px cursor-pointer transition-all duration-200"
            :class="
              result?.path === bound.path
                ? 'border-brand-500/40 bg-brand-500/10 text-brand-500'
                : 'border-transparent bg-black/5 dark:bg-white/8 text-ink-sub hover:bg-black/8 dark:hover:bg-white/12'
            "
            :title="`${bound.label}：${bound.path}`"
            @click="goBound(bound)"
          >
            <NIcon
              :size="13"
              class="shrink-0"
              :class="
                result?.path === bound.path ? 'text-brand-500' : 'opacity-60'
              "
            >
              <component :is="entryIcon(bound.source)" />
            </NIcon>
            <span class="shrink-0 opacity-70">{{ bound.label }}</span>
            <span
              class="tracking-tight"
              :class="bound.source === 'root' ? '' : 'font-mono'"
              >{{ bound.name }}</span
            >
          </button>

          <NPopover
            v-if="overflowChips.length"
            v-model:show="overflowShow"
            trigger="click"
            placement="bottom-start"
            :show-arrow="false"
          >
            <template #trigger>
              <button
                type="button"
                class="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-transparent bg-black/5 dark:bg-white/8 text-11px text-ink-sub cursor-pointer transition-all duration-200 hover:bg-black/8 dark:hover:bg-white/12"
              >
                <span>更多</span>
                <span class="opacity-60">{{ overflowChips.length }}</span>
                <NIcon :size="12" class="opacity-60">
                  <ChevronDownOutline />
                </NIcon>
              </button>
            </template>

            <div
              class="min-w-64 max-w-96 max-h-64 overflow-y-auto flex flex-col gap-0.5"
            >
              <button
                v-for="bound in overflowChips"
                :key="bound.path"
                type="button"
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg border-none bg-transparent text-left text-11px cursor-pointer transition-colors duration-200 hover:bg-black/5 dark:hover:bg-white/10"
                :class="
                  result?.path === bound.path
                    ? 'text-brand-500'
                    : 'text-ink-sub'
                "
                @click="goBound(bound)"
              >
                <NIcon :size="13" class="shrink-0 opacity-70">
                  <component :is="entryIcon(bound.source)" />
                </NIcon>
                <span class="shrink-0 opacity-70">{{ bound.label }}</span>
                <span class="min-w-0 flex-1 truncate font-mono">{{
                  bound.path
                }}</span>
              </button>
            </div>
          </NPopover>
        </template>
        <span v-else class="text-11px text-ink-sub">
          {{ boundsLoading ? '加载中…' : '未读取到边界，可直接输入路径' }}
        </span>
      </div>

      <!-- 目录列表 -->
      <div
        class="h-72 overflow-y-auto rounded-2xl border border-glass-border dark:border-glass-border-dark px-2 py-2"
      >
        <NSpin :show="loading" size="small">
          <div v-if="error" class="px-3 py-6 text-center">
            <p class="m-0 text-12px text-red-500">{{ error }}</p>
            <p class="m-0 mt-1 text-11px text-ink-sub">
              可点上方「可访问位置」直接跳到允许目录，或修改路径后回车重试
            </p>
            <div class="mt-3 flex items-center justify-center gap-2">
              <NButton
                v-if="bounds.length"
                size="tiny"
                type="primary"
                secondary
                @click="backToAllowed"
              >
                回到可用目录
              </NButton>
              <NButton size="tiny" @click="load(pathInput)">重试</NButton>
            </div>
          </div>

          <div
            v-else-if="!loading && result && result.entries.length === 0"
            class="px-3 py-10 text-center"
          >
            <NIcon :size="24" class="text-ink-sub opacity-60">
              <FolderOutline />
            </NIcon>
            <p class="m-0 mt-2 text-12px text-ink-sub">
              该目录下没有子目录，可直接选择当前目录
            </p>
          </div>

          <div
            v-else-if="!loading && !result"
            class="px-3 py-10 text-center text-12px text-ink-sub"
          >
            尚未加载目录
          </div>

          <ul v-else class="m-0 p-0 list-none flex flex-col gap-1">
            <li v-for="entry in result?.entries ?? []" :key="entry.path">
              <button
                class="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border-none bg-transparent cursor-pointer transition-colors duration-200 text-ink-sub hover:bg-white/60 dark:hover:bg-white/8"
                :title="entry.path"
                @click="enter(entry.path)"
              >
                <NIcon :size="17" class="shrink-0 text-brand-500">
                  <FolderOutline />
                </NIcon>
                <span class="flex-1 min-w-0 truncate text-left text-13px">
                  {{ entry.name }}
                </span>
                <span class="text-11px text-ink-sub">进入</span>
              </button>
            </li>
          </ul>
        </NSpin>
      </div>

      <p v-if="result?.truncated" class="m-0 text-11px text-ink-sub">
        该目录子目录较多（共 {{ result.total }} 个），仅展示前
        {{ result.entries.length }} 个，请手动输入更精确的路径继续。
      </p>

      <div class="flex items-center justify-between gap-3">
        <p class="m-0 text-11px text-ink-sub">
          仅可浏览允许范围内的目录（根目录父级、白名单与用户主目录），不显示文件；
          新建根目录同样受此限制。
        </p>
        <div class="flex items-center gap-2 shrink-0">
          <NButton size="small" quaternary @click="close">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :disabled="!result || !!error"
            @click="chooseCurrent"
          >
            选择当前目录
          </NButton>
        </div>
      </div>
    </div>
  </NModal>
</template>
