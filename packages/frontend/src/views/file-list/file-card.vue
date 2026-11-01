<script setup lang="ts">
import { ref } from 'vue';
import { NIcon } from 'naive-ui';
import {
  DownloadOutline,
  TrashOutline,
  CopyOutline,
  LinkOutline,
  CreateOutline,
} from '@vicons/ionicons5';
import FilePreview from './components/file-preview.vue';
import ImageFilePreview from './components/image-file-preview.vue';
import ArchiveFilePreview from './components/archive-file-preview.vue';
import DefaultFilePreview from './components/default-file-preview.vue';
import CopyLinkModal from './components/copy-link-modal.vue';
import CreateShareModal from './components/create-share-modal.vue';
import RenameFileModal from './components/rename-file-modal.vue';
import { isSupported, isArchive, isImage, isPptExternal } from '@/utils/file-types';

interface FileItem {
  path: string;
  size: number;
  mtime: string | number;
}

const props = defineProps<{
  file: FileItem;
  fileUrl: (path: string) => string;
  formatSize: (bytes: number) => string;
  formatDate: (value: string | number) => string;
}>();

const emit = defineEmits<{
  (e: 'download', path: string): void;
  (e: 'delete', path: string): void;
}>();

const showCopyModal = ref(false);
const showShareModal = ref(false);
const showRenameModal = ref(false);

function openCopyModal() {
  showCopyModal.value = true;
}

function closeCopyModal() {
  showCopyModal.value = false;
}
</script>

<template>
  <div
    class="relative bg-base rounded-xl border border-base overflow-hidden transition-all hover:-translate-y-1 hover:shadow-[0_8px_16px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_8px_16px_rgba(0,0,0,0.4)] hover:border-transparent shadow-sm"
  >
    <div class="block">
      <div
        class="h-24 bg-container flex items-center justify-center relative overflow-hidden"
      >
        <template v-if="isImage(props.file.path)">
          <ImageFilePreview
            :file-path="props.file.path"
            :file-url="props.fileUrl"
          />
        </template>
        <template
          v-else-if="isSupported(props.file.path) || isPptExternal(props.file.path)"
        >
          <FilePreview :file-path="props.file.path" :file-url="props.fileUrl" />
        </template>
        <template v-else-if="isArchive(props.file.path)">
          <ArchiveFilePreview />
        </template>
        <template v-else>
          <DefaultFilePreview />
        </template>
      </div>
    </div>
    <div class="px-3 py-3">
      <a
        :href="props.fileUrl(props.file.path)"
        target="_blank"
        class="block text-sm font-medium text-base hover:text-primary leading-tight truncate mb-2"
        :title="props.file.path"
      >
        {{ props.file.path }}
      </a>
      <div class="flex items-center justify-between text-xs text-gray-500">
        <span class="truncate">{{ props.formatSize(props.file.size) }}</span>
        <span>{{ props.formatDate(props.file.mtime).split(' ')[0] }}</span>
      </div>
    </div>
    <div
      class="absolute top-2 right-2 flex gap-2 opacity-0 hover:opacity-100 transition-opacity"
    >
      <button
        type="button"
        class="w-7 h-7 flex items-center justify-center rounded border border-base bg-base text-gray-500 shadow-sm hover:text-primary hover:border-primary"
        title="复制链接"
        @click="openCopyModal"
      >
        <NIcon>
          <CopyOutline />
        </NIcon>
      </button>
      <button
        type="button"
        class="w-7 h-7 flex items-center justify-center rounded border border-base bg-base text-gray-500 shadow-sm hover:text-blue-500 hover:border-blue-500"
        title="创建分享链接"
        @click="showShareModal = true"
      >
        <NIcon>
          <LinkOutline />
        </NIcon>
      </button>
      <button
        type="button"
        class="w-7 h-7 flex items-center justify-center rounded border border-base bg-base text-gray-500 shadow-sm hover:text-amber-500 hover:border-amber-500"
        title="重命名"
        @click="showRenameModal = true"
      >
        <NIcon>
          <CreateOutline />
        </NIcon>
      </button>
      <button
        class="w-7 h-7 flex items-center justify-center rounded border border-base bg-base text-gray-500 shadow-sm hover:text-pink-500 hover:border-pink-500"
        title="下载"
        @click.prevent="emit('download', props.file.path)"
      >
        <NIcon>
          <DownloadOutline />
        </NIcon>
      </button>
      <button
        class="w-7 h-7 flex items-center justify-center rounded border border-base bg-base text-gray-500 shadow-sm hover:text-red-500 hover:border-red-500"
        type="button"
        title="删除"
        @click="emit('delete', props.file.path)"
      >
        <NIcon>
          <TrashOutline />
        </NIcon>
      </button>
    </div>
    <CopyLinkModal
      :visible="showCopyModal"
      :file-path="props.file.path"
      :file-url="props.fileUrl(props.file.path)"
      @close="closeCopyModal"
    />
    <CreateShareModal
      :visible="showShareModal"
      :file-path="props.file.path"
      @close="showShareModal = false"
    />
    <RenameFileModal
      :visible="showRenameModal"
      :file-path="props.file.path"
      @close="showRenameModal = false"
    />
  </div>
</template>
