<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NIcon, NModal, NSpin } from 'naive-ui';
import {
  ArrowUpOutline,
  FolderOutline,
  RefreshOutline,
  ServerOutline,
} from '@vicons/ionicons5';
import type { BrowseDirectoriesResult } from '@vakao/shared';
import { browseDirectories } from '@/api/roots';
import { getErrorMessage } from '@/utils/http';

/**
 * 服务器目录选择弹框
 *
 * - 数据来自 GET /roots/browse（仅目录，不返回文件）
 * - 后端限制在「已配置根目录的父级 / 用户主目录 / 白名单」之内，
 *   越界、`..`、相对路径、无权限目录都会返回可读错误，这里原样展示
 * - 逐级进入 / 返回上级 / 选择当前目录回填路径；手输仍保留在弹框外作为兜底
 */
const props = defineProps<{
  show: boolean;
  /** 打开时优先浏览的路径；为空则从后端主目录开始 */
  initialPath?: string;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'select', path: string): void;
}>();

const loading = ref(false);
const error = ref('');
const result = ref<BrowseDirectoriesResult | null>(null);

const canGoUp = computed(() => !!result.value?.parent);

async function load(path?: string) {
  loading.value = true;
  error.value = '';
  try {
    result.value = await browseDirectories(path);
  } catch (e) {
    // 保留上一次成功结果，避免报错时列表整块消失
    error.value = getErrorMessage(e, '目录加载失败');
  } finally {
    loading.value = false;
  }
}

function enter(path: string) {
  void load(path);
}

function goUp() {
  if (result.value?.parent) void load(result.value.parent);
}

function chooseCurrent() {
  if (!result.value) return;
  emit('select', result.value.path);
  emit('update:show', false);
}

function close() {
  emit('update:show', false);
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) return;
    result.value = null;
    void load(props.initialPath?.trim() || undefined);
  },
);
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="浏览服务器目录"
    style="width: 580px"
    @update:show="(value: boolean) => emit('update:show', value)"
  >
    <div class="flex flex-col gap-3">
      <!-- 当前路径 / 返回上级 -->
      <div class="glass-panel px-3 py-2 flex items-center gap-2">
        <NIcon :size="15" class="shrink-0 text-brand-500">
          <ServerOutline />
        </NIcon>
        <span
          class="min-w-0 flex-1 truncate text-12px font-mono text-ink"
          :title="result?.path ?? ''"
        >
          {{ result?.path ?? '尚未加载' }}
        </span>
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

      <!-- 目录列表 -->
      <div
        class="h-72 overflow-y-auto rounded-2xl border border-glass-border dark:border-glass-border-dark px-2 py-2"
      >
        <NSpin :show="loading" size="small">
          <div v-if="error" class="px-3 py-8 text-center">
            <p class="m-0 text-12px text-red-500">{{ error }}</p>
            <p class="m-0 mt-1 text-11px text-ink-sub">
              可返回上级重试，或直接在弹框外手动输入绝对路径
            </p>
            <NButton
              class="mt-2"
              size="tiny"
              @click="load(result?.path ?? initialPath)"
            >
              重试
            </NButton>
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
          仅可浏览允许范围内的目录（已配置根目录的父级、用户主目录与白名单），不显示文件。
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
