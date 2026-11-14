<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import {
  DocumentTextOutline,
  DownloadOutline,
  EyeOutline,
  RefreshOutline,
} from '@vicons/ionicons5';
import type { ShareCollectionFile } from '@/api/shares';
import { formatBytes, getFileKind, isPreviewable } from '@/utils/file-types';
import ListLoading from '@/components/common/list-loading.vue';

/**
 * 已解锁的文件集合：卡片头尾固定，只有文件列表滚动；
 * 已删除的文件标灰并禁用预览/下载
 */
defineProps<{
  files: ShareCollectionFile[];
  rootId: string;
  category: string;
  loading: boolean;
  loadingText: string;
  error: string;
  missingCount: number;
  fileUrl: (index: number, download?: boolean) => string;
}>();

const emit = defineEmits<{
  refresh: [];
  preview: [index: number];
}>();
</script>

<template>
  <section class="glass-panel px-5 py-5 flex flex-1 min-h-0 flex-col gap-3">
    <div class="flex items-center gap-2 flex-wrap shrink-0">
      <p class="m-0 text-14px font-600 text-ink">
        文件集合
        <span class="text-11px text-ink-sub">（{{ files.length }} 个）</span>
      </p>
      <NButton size="tiny" quaternary class="ml-auto" @click="emit('refresh')">
        <template #icon
          ><NIcon><RefreshOutline /></NIcon
        ></template>
        刷新列表
      </NButton>
    </div>

    <p v-if="category" class="m-0 shrink-0 text-11px text-ink-sub truncate">
      {{ rootId }} / {{ category }}
    </p>

    <div class="relative flex flex-1 min-h-0 flex-col">
      <div class="share-scroll flex flex-1 min-h-0 flex-col">
        <p v-if="error" class="m-0 text-12px text-red-500 leading-5">
          {{ error }}
        </p>
        <div
          v-else-if="!loading && files.length === 0"
          class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-8 text-center text-12px text-ink-sub"
        >
          文件集合为空：分享创建后文件可能已被全部删除，请联系分享者重新创建。
        </div>
        <div v-else class="flex flex-col gap-2">
          <p
            v-if="missingCount > 0"
            class="m-0 text-11px text-amber-600 dark:text-amber-400"
          >
            有 {{ missingCount }} 个文件已被删除，已标记为不可预览/下载。
          </p>
          <ul class="m-0 p-0 list-none flex flex-col gap-2">
            <li
              v-for="(file, index) in files"
              :key="file.path"
              class="rounded-xl border border-glass-border dark:border-glass-border-dark bg-white/45 dark:bg-white/4 px-3 py-2.5 flex items-center gap-3"
              :class="!file.exists ? 'opacity-60' : ''"
            >
              <div
                class="glass-chip w-8 h-8 flex items-center justify-center shrink-0"
              >
                <NIcon :size="16" class="text-brand-600 dark:text-brand-400">
                  <DocumentTextOutline />
                </NIcon>
              </div>
              <span class="min-w-0 flex-1">
                <span
                  class="block text-12px text-ink truncate"
                  :title="file.path"
                >
                  {{ file.name }}
                </span>
                <span
                  class="block text-11px text-ink-sub truncate"
                  :title="file.path"
                >
                  {{ file.path }}
                  <template v-if="file.exists">
                    · {{ formatBytes(file.size ?? 0) }}</template
                  >
                </span>
              </span>
              <span
                v-if="!file.exists"
                class="text-10px text-amber-600 dark:text-amber-400 shrink-0"
              >
                文件已删除
              </span>
              <span v-else class="text-10px text-ink-sub shrink-0">
                {{ getFileKind(file.name) }}
              </span>
              <NButton
                v-if="file.exists && isPreviewable(file.name)"
                size="tiny"
                quaternary
                @click="emit('preview', index)"
              >
                <template #icon
                  ><NIcon><EyeOutline /></NIcon
                ></template>
                预览
              </NButton>
              <NButton
                v-if="file.exists"
                tag="a"
                :href="fileUrl(index, true)"
                size="tiny"
                quaternary
              >
                <template #icon
                  ><NIcon><DownloadOutline /></NIcon
                ></template>
                下载
              </NButton>
            </li>
          </ul>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>
  </section>
</template>

<style scoped>
.share-scroll {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
