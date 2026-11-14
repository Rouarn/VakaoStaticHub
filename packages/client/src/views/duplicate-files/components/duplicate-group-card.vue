<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CopyOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { DuplicateFileItem, DuplicateGroup } from '@vakao/shared';
import {
  formatBytes,
  formatTime,
  getExtension,
  getFileKind,
} from '@/utils/file-types';
import { buildThumbUrl } from '@/utils/file-url';
import { truncateMiddle } from '@/utils/format';

/**
 * 重复文件分组卡片：默认展示缩略图摘要，展开后为逐文件对比表，
 * 支持切换保留项；预览/清理动作由父级处理
 */
defineProps<{
  group: DuplicateGroup;
  expanded: boolean;
  keepIndex: number;
  rootName: (id: string) => string;
}>();

const emit = defineEmits<{
  toggle: [hash: string];
  'set-keep': [group: DuplicateGroup, index: number];
  cleanup: [group: DuplicateGroup];
  preview: [group: DuplicateGroup, index: number];
}>();

function isImageFile(file: DuplicateFileItem) {
  return getFileKind(file.name) === 'image';
}

function extOf(file: DuplicateFileItem) {
  return (getExtension(file.name) || 'FILE').toUpperCase();
}

function thumbOf(file: DuplicateFileItem) {
  return buildThumbUrl({ code: file.code }, 'thumbnail');
}
</script>

<template>
  <section class="glass-panel px-4 py-3 flex flex-col gap-3">
    <div class="flex items-center gap-3 flex-wrap">
      <div class="glass-chip w-9 h-9 flex items-center justify-center shrink-0">
        <NIcon :size="18" class="text-brand-600 dark:text-brand-400"
          ><CopyOutline
        /></NIcon>
      </div>
      <div class="min-w-0 flex-1">
        <p
          class="m-0 text-13px text-ink font-600 truncate"
          :title="group.files[keepIndex]?.name"
        >
          {{ group.files[keepIndex]?.name ?? '重复文件组' }}
        </p>
        <p class="m-0 mt-0.5 text-11px text-ink-sub">
          单文件 {{ formatBytes(group.size) }} · {{ group.count }} 个副本 ·
          可释放 {{ formatBytes(group.size * (group.count - 1)) }} ·
          <span class="font-mono" :title="group.contentHash">{{
            truncateMiddle(group.contentHash, 14, 10)
          }}</span>
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <NButton size="tiny" @click="emit('toggle', group.contentHash)">
          <template #icon>
            <NIcon>
              <ChevronDownOutline v-if="expanded" />
              <ChevronForwardOutline v-else />
            </NIcon>
          </template>
          {{ expanded ? '收起对比' : '展开对比' }}
        </NButton>
        <NButton
          size="tiny"
          type="error"
          quaternary
          @click="emit('cleanup', group)"
        >
          <template #icon
            ><NIcon><TrashOutline /></NIcon
          ></template>
          清理本组
        </NButton>
      </div>
    </div>

    <!-- 默认展示摘要，展开后对比 -->
    <div v-if="!expanded" class="flex flex-wrap items-start gap-2">
      <button
        v-for="(file, index) in group.files"
        :key="`${file.rootId}-${file.category}-${file.relPath}`"
        type="button"
        class="group relative w-14 text-left bg-transparent border-none p-0 cursor-pointer"
        :title="`${file.name}\n${rootName(file.rootId)} / ${file.category}`"
        @click="emit('preview', group, index)"
      >
        <span
          class="block w-14 h-14 rounded-lg overflow-hidden border border-[var(--mat-line)] bg-[var(--mat-chip)]"
          :class="index === keepIndex ? 'ring-2 ring-brand-500/70' : ''"
        >
          <img
            v-if="isImageFile(file)"
            :src="thumbOf(file)"
            :alt="file.name"
            loading="lazy"
            decoding="async"
            class="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
          <span
            v-else
            class="w-full h-full flex items-center justify-center text-10px font-600 text-ink-sub"
          >
            {{ extOf(file) }}
          </span>
        </span>
        <span
          v-if="index === keepIndex"
          class="absolute left-1 top-1 rounded bg-brand-600 px-1 text-9px text-white leading-4"
          >保留</span
        >
        <span class="mt-1 block text-10px text-ink-sub truncate max-w-14">{{
          file.name
        }}</span>
      </button>
    </div>

    <div v-else class="overflow-x-auto">
      <table class="app-table w-full min-w-720px border-collapse text-12px">
        <thead>
          <tr class="text-left text-11px text-ink-sub">
            <th class="py-2 pr-3 font-500">保留</th>
            <th class="py-2 px-2 font-500">文件</th>
            <th class="py-2 px-2 font-500">根目录 / 分类</th>
            <th class="py-2 px-2 font-500 text-right">大小</th>
            <th class="py-2 pl-2 font-500 text-right">修改时间</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(file, index) in group.files"
            :key="`${file.rootId}-${file.category}-${file.relPath}`"
            class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
            :class="index === keepIndex ? 'bg-brand-500/8' : ''"
          >
            <td class="py-2 pr-3">
              <NButton
                size="tiny"
                :type="index === keepIndex ? 'primary' : 'default'"
                :quaternary="index !== keepIndex"
                @click="emit('set-keep', group, index)"
              >
                {{ index === keepIndex ? '保留此件' : '改为保留' }}
              </NButton>
            </td>
            <td class="py-2 px-2 min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  class="w-10 h-10 rounded-md overflow-hidden border border-[var(--mat-line)] bg-[var(--mat-chip)] shrink-0 p-0 cursor-pointer"
                  :title="`预览 ${file.name}`"
                  @click="emit('preview', group, index)"
                >
                  <img
                    v-if="isImageFile(file)"
                    :src="thumbOf(file)"
                    :alt="file.name"
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover"
                  />
                  <span
                    v-else
                    class="w-full h-full flex items-center justify-center text-9px font-600 text-ink-sub"
                    >{{ extOf(file) }}</span
                  >
                </button>
                <div class="min-w-0">
                  <p
                    class="m-0 text-ink truncate max-w-260px"
                    :title="file.relPath"
                  >
                    {{ file.name }}
                  </p>
                  <p class="m-0 text-10px text-ink-sub truncate max-w-260px">
                    {{ file.relPath }}
                  </p>
                </div>
              </div>
            </td>
            <td class="py-2 px-2 text-ink-sub">
              {{ rootName(file.rootId) }} / {{ file.category }}
            </td>
            <td class="py-2 px-2 text-right tabular-nums">
              {{ formatBytes(file.size) }}
            </td>
            <td class="py-2 pl-2 text-right text-ink-sub">
              {{ formatTime(file.mtime) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
