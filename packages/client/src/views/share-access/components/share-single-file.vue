<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import {
  DocumentTextOutline,
  DownloadOutline,
  EyeOutline,
} from '@vicons/ionicons5';
import type { ShareInfo } from '@vakao/shared';
import { formatBytes, isImage, isPreviewable } from '@/utils/file-types';

/** 已解锁的单文件分享：图片按 share 档原位展示，其余提供预览/下载 */
defineProps<{
  info: ShareInfo;
  file: { name: string; path: string };
  singleSize: number | null;
  singleMissing: boolean;
  src: string;
  imageSrc: string;
  downloadSrc: string;
}>();

const emit = defineEmits<{
  preview: [];
}>();
</script>

<template>
  <section class="glass-panel px-5 py-5 flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <div
        class="glass-chip w-11 h-11 flex items-center justify-center shrink-0"
      >
        <NIcon :size="22" class="text-brand-600 dark:text-brand-400">
          <DocumentTextOutline />
        </NIcon>
      </div>
      <div class="min-w-0 flex-1">
        <p class="m-0 text-14px font-600 text-ink truncate" :title="file.name">
          {{ file.name }}
        </p>
        <p class="m-0 mt-0.5 text-11px text-ink-sub">
          单文件分享 · {{ info.category }}
          <template v-if="singleMissing">
            ·
            <span class="text-amber-600 dark:text-amber-400">文件已删除</span>
          </template>
          <template v-else-if="singleSize !== null">
            · {{ formatBytes(singleSize) }}
          </template>
        </p>
      </div>
    </div>

    <img
      v-if="isImage(file.name) && !singleMissing"
      :src="imageSrc"
      :alt="file.name"
      class="max-h-64 w-auto mx-auto rounded-xl object-contain"
    />

    <div v-if="singleMissing" class="flex items-center gap-2">
      <span class="text-12px text-amber-600 dark:text-amber-400">
        文件已被删除，请联系分享者重新创建分享。
      </span>
    </div>

    <div v-else class="flex items-center gap-2 flex-wrap">
      <NButton
        v-if="isPreviewable(file.name)"
        type="primary"
        size="small"
        @click="emit('preview')"
      >
        <template #icon
          ><NIcon><EyeOutline /></NIcon
        ></template>
        在线预览
      </NButton>
      <NButton
        tag="a"
        :href="downloadSrc"
        size="small"
        :type="isPreviewable(file.name) ? 'default' : 'primary'"
      >
        <template #icon
          ><NIcon><DownloadOutline /></NIcon
        ></template>
        下载文件
      </NButton>
    </div>
  </section>
</template>
