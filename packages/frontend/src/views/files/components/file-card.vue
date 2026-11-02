<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Component } from 'vue';
import { NCheckbox, NDropdown, NIcon } from 'naive-ui';
import { useIntersectionObserver } from '@vueuse/core';
import {
  ArchiveOutline,
  CodeSlashOutline,
  DocumentOutline,
  DocumentTextOutline,
  GridOutline,
  GlobeOutline,
  ImageOutline,
  MusicalNotesOutline,
  PlayOutline,
  VideocamOutline,
} from '@vicons/ionicons5';
import type { FileItem } from '@vakao/shared';
import { buildFileUrl, buildThumbUrl } from '@/utils/file-url';
import {
  formatBytes,
  formatDuration,
  formatTime,
  getExtension,
  getFileKind,
} from '@/utils/file-types';
import { useVideoPoster } from '@/composables/use-video-poster';

/**
 * 文件卡片（网格 / 列表两种形态）
 *
 * 差异化媒体区：
 * - 图片：后端缩略图，深色下 media-image 降透明度、hover 恢复
 * - 视频：进入视口后才提取封面帧，居中玻璃播放按钮 + 右下角 dayjs 时长
 * - 音频：渐变底 + 伪波形 + 播放按钮
 * - 其他：按格式的类型图标 + 元信息
 */
const props = defineProps<{
  file: FileItem;
  rootId: string;
  category: string;
  selected: boolean;
  mode: 'grid' | 'list';
}>();

const emit = defineEmits<{
  'toggle-select': [path: string];
  open: [file: FileItem];
  rename: [file: FileItem];
  move: [file: FileItem];
  share: [file: FileItem];
  'copy-link': [file: FileItem];
  remove: [file: FileItem];
}>();

const kind = computed(() => getFileKind(props.file.name));
const urlParams = computed(() => ({
  rootId: props.rootId,
  category: props.category,
  relPath: props.file.path,
}));
const previewUrl = computed(() => buildFileUrl(urlParams.value));
const thumbUrl = computed(() => buildThumbUrl(urlParams.value, 480));

const ICON_BY_KIND: Record<string, Component> = {
  image: ImageOutline,
  video: VideocamOutline,
  audio: MusicalNotesOutline,
  text: CodeSlashOutline,
  markdown: DocumentTextOutline,
  html: GlobeOutline,
  pdf: DocumentTextOutline,
  word: DocumentTextOutline,
  excel: GridOutline,
  archive: ArchiveOutline,
  other: DocumentOutline,
};
const kindIcon = computed(() => ICON_BY_KIND[kind.value] ?? DocumentOutline);

// —— 视频封面（懒触发） ——
const mediaRef = ref<HTMLElement | null>(null);
const { poster, duration, load } = useVideoPoster();

if (kind.value === 'video') {
  const { stop } = useIntersectionObserver(
    mediaRef,
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void load(previewUrl.value);
        stop();
      }
    },
    { rootMargin: '200px' },
  );
}

const menuOptions = [
  { label: '预览', key: 'preview' },
  { label: '新建分享', key: 'share' },
  { label: '重命名', key: 'rename' },
  { label: '移动到分类', key: 'move' },
  { label: '复制直链', key: 'copy-link' },
  { label: '删除', key: 'delete' },
];

function onAction(key: string) {
  if (key === 'preview') emit('open', props.file);
  else if (key === 'share') emit('share', props.file);
  else if (key === 'rename') emit('rename', props.file);
  else if (key === 'move') emit('move', props.file);
  else if (key === 'copy-link') emit('copy-link', props.file);
  else if (key === 'delete') emit('remove', props.file);
}
</script>

<template>
  <!-- 网格形态 -->
  <div
    v-if="props.mode === 'grid'"
    class="glass-card group relative overflow-hidden cursor-pointer"
    :class="{ 'ring-2 ring-brand-500/70': props.selected }"
    @click="emit('open', props.file)"
  >
    <div ref="mediaRef" class="media-frame aspect-square">
      <img
        v-if="kind === 'image'"
        :src="thumbUrl"
        :alt="props.file.name"
        class="media-image"
        loading="lazy"
      />

      <template v-else-if="kind === 'video'">
        <img v-if="poster" :src="poster" class="media-image" alt="" />
        <div
          v-else
          class="w-full h-full flex items-center justify-center text-white/70"
        >
          <NIcon :size="34"><VideocamOutline /></NIcon>
        </div>
        <div class="absolute inset-0 flex items-center justify-center">
          <span
            class="w-12 h-12 rounded-full flex items-center justify-center bg-white/25 dark:bg-white/15 backdrop-blur-md border border-white/40 text-white"
          >
            <NIcon :size="24"><PlayOutline /></NIcon>
          </span>
        </div>
        <span
          v-if="duration > 0"
          class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/55 text-white text-11px leading-4"
        >
          {{ formatDuration(duration) }}
        </span>
      </template>

      <template v-else-if="kind === 'audio'">
        <div
          class="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand-400/25 to-brand-700/25"
        >
          <span
            class="w-12 h-12 rounded-full flex items-center justify-center bg-white/30 dark:bg-white/15 backdrop-blur-md border border-white/40 text-white"
          >
            <NIcon :size="24"><PlayOutline /></NIcon>
          </span>
          <div class="flex items-end gap-0.5 h-8 opacity-70">
            <span
              v-for="i in 16"
              :key="i"
              class="w-1 rounded-sm bg-brand-500 dark:bg-brand-400"
              :style="{ height: `${30 + ((i * 13) % 70)}%` }"
            />
          </div>
        </div>
      </template>

      <div
        v-else
        class="w-full h-full flex flex-col items-center justify-center gap-2 text-brand-500 dark:text-brand-400"
      >
        <NIcon :size="38" :component="kindIcon" />
        <span class="text-11px uppercase tracking-widest text-ink-sub">
          {{ getExtension(props.file.name) || 'file' }}
        </span>
      </div>

      <!-- 选中框 -->
      <NCheckbox
        class="absolute top-2 left-2"
        :checked="props.selected"
        @click.stop
        @update:checked="emit('toggle-select', props.file.path)"
      />

      <!-- 操作菜单 -->
      <div
        class="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <NDropdown
          trigger="click"
          :options="menuOptions"
          placement="bottom-end"
          @select="onAction"
        >
          <span
            class="w-7 h-7 rounded-full flex items-center justify-center bg-black/40 text-white text-13px cursor-pointer"
            @click.stop
          >
            ⋯
          </span>
        </NDropdown>
      </div>
    </div>

    <div class="px-3 py-2">
      <p
        class="m-0 text-13px font-500 text-ink truncate"
        :title="props.file.name"
      >
        {{ props.file.name }}
      </p>
      <p class="m-0 mt-0.5 text-11px text-ink-sub">
        {{ formatBytes(props.file.size) }} · {{ formatTime(props.file.mtime) }}
      </p>
    </div>
  </div>

  <!-- 列表形态 -->
  <div
    v-else
    class="glass-panel px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors hover:bg-white/70 dark:hover:bg-white/8"
    :class="{ 'ring-2 ring-brand-500/70': props.selected }"
    @click="emit('open', props.file)"
  >
    <NCheckbox
      :checked="props.selected"
      @click.stop
      @update:checked="emit('toggle-select', props.file.path)"
    />
    <div class="media-frame w-10 h-10 shrink-0 rounded-lg overflow-hidden">
      <img
        v-if="kind === 'image'"
        :src="thumbUrl"
        alt=""
        class="media-image"
        loading="lazy"
      />
      <img v-else-if="poster" :src="poster" alt="" class="media-image" />
      <div
        v-else
        class="w-full h-full flex items-center justify-center text-brand-500 dark:text-brand-400"
      >
        <NIcon :size="18" :component="kindIcon" />
      </div>
    </div>
    <div class="min-w-0 flex-1">
      <p
        class="m-0 text-13px font-500 text-ink truncate"
        :title="props.file.name"
      >
        {{ props.file.name }}
      </p>
      <p class="m-0 mt-0.5 text-11px text-ink-sub truncate">
        {{ props.file.path }}
      </p>
    </div>
    <span class="w-20 text-right text-12px text-ink-sub shrink-0">
      {{ formatBytes(props.file.size) }}
    </span>
    <span
      class="w-36 text-right text-12px text-ink-sub shrink-0 hidden md:block"
    >
      {{ formatTime(props.file.mtime) }}
    </span>
    <NDropdown
      trigger="click"
      :options="menuOptions"
      placement="bottom-end"
      @select="onAction"
    >
      <span
        class="w-7 h-7 rounded-full flex items-center justify-center text-ink-sub cursor-pointer hover:bg-white/60 dark:hover:bg-white/10"
        @click.stop
      >
        ⋯
      </span>
    </NDropdown>
  </div>
</template>
