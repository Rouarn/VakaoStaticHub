<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NEmpty, NSpin } from 'naive-ui';
import type { FileItem } from '@vakao/shared';
import ListLoading from '@/components/common/list-loading.vue';
import FileCard from './file-card.vue';

/** 文件库内容区：错误/扫描空态、网格或列表、加载遮罩 */
defineProps<{
  error: string;
  loading: boolean;
  loadingText: string;
  scanning: boolean;
  scannedFiles: number;
  scanningDir: string;
  q: string;
  files: FileItem[];
  selected: Set<string>;
  viewMode: 'grid' | 'list';
}>();

const emit = defineEmits<{
  retry: [];
  'clear-search': [];
  upload: [];
  'toggle-select': [string];
  open: [FileItem];
  rename: [FileItem];
  move: [FileItem];
  share: [FileItem];
  'copy-link': [FileItem];
  'copy-preview-link': [FileItem];
  remove: [FileItem];
}>();

const scrollRef = ref<HTMLElement | null>(null);

/** 翻页后回到顶部 */
function scrollToTop() {
  scrollRef.value?.scrollTo({ top: 0 });
}

defineExpose({ scrollToTop });
</script>

<template>
  <!-- 内容区：加载遮罩相对可视区域居中，不随内容高度或滚动位置偏移 -->
  <div class="relative flex-1 min-h-0">
    <div ref="scrollRef" class="h-full overflow-y-auto pr-1">
      <div v-if="error" class="glass-panel px-6 py-10 text-center">
        <p class="m-0 text-13px text-ink-sub">{{ error }}</p>
        <NButton class="mt-3" size="small" @click="emit('retry')">
          重试
        </NButton>
      </div>

      <div
        v-else-if="!loading && files.length === 0"
        class="glass-panel px-6 py-16 flex flex-col items-center gap-3"
      >
        <template v-if="scanning && !q">
          <NSpin size="small" />
          <p class="m-0 text-13px text-ink-sub">
            正在扫描 · 已处理
            <span class="tabular-nums">{{ scannedFiles }}</span> 个文件
          </p>
          <p
            v-if="scanningDir"
            class="m-0 max-w-full truncate text-11px text-ink-sub font-mono"
          >
            {{ scanningDir }}
          </p>
        </template>
        <template v-else>
          <NEmpty
            :description="q ? `没有匹配「${q}」的文件` : '当前分类还没有文件'"
          />
          <NButton v-if="q" size="small" @click="emit('clear-search')"
            >清除搜索</NButton
          >
          <NButton v-else size="small" type="primary" @click="emit('upload')">
            上传第一个文件
          </NButton>
        </template>
      </div>

      <div
        v-else-if="viewMode === 'grid'"
        class="content-grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(212px,1fr))]"
      >
        <FileCard
          v-for="file in files"
          :key="file.path"
          :file="file"
          :selected="selected.has(file.path)"
          mode="grid"
          @toggle-select="emit('toggle-select', $event)"
          @open="emit('open', $event)"
          @rename="emit('rename', $event)"
          @move="emit('move', $event)"
          @share="emit('share', $event)"
          @copy-link="emit('copy-link', $event)"
          @copy-preview-link="emit('copy-preview-link', $event)"
          @remove="emit('remove', $event)"
        />
      </div>

      <div v-else class="flex flex-col gap-2">
        <FileCard
          v-for="file in files"
          :key="file.path"
          :file="file"
          :selected="selected.has(file.path)"
          mode="list"
          @toggle-select="emit('toggle-select', $event)"
          @open="emit('open', $event)"
          @rename="emit('rename', $event)"
          @move="emit('move', $event)"
          @share="emit('share', $event)"
          @copy-link="emit('copy-link', $event)"
          @copy-preview-link="emit('copy-preview-link', $event)"
          @remove="emit('remove', $event)"
        />
      </div>
    </div>

    <ListLoading :show="loading" :text="loadingText" />
  </div>
</template>
