<script setup lang="ts">
import UrlInput from './components/url-input.vue';
import FileViewer from './components/file-viewer.vue';
import StatusDisplay from './components/status-display.vue';
import { useFilePreview } from '@/composables/use-file-preview';

defineOptions({ name: 'FilePreviewPage' });

const {
  fileUrl,
  inputUrl,
  isShowToolbar,
  loadError,
  errorMessage,
  hasPreview,
  supported,
  reloadTrigger,
  handlePreview,
  handleClear,
  handleError,
  handleReady,
  handleLoad,
} = useFilePreview();

import { ref, watch } from 'vue';

const fileViewerRef = ref<InstanceType<typeof FileViewer> | null>(null);

const handleReload = () => {
  fileViewerRef.value?.reload();
};

watch(reloadTrigger, () => {
  handleReload();
});

const getCurrentStatus = (): 'empty' | 'unsupported' | 'error' | 'preview' => {
  if (loadError.value) return 'error';
  if (!fileUrl.value) return 'empty';
  if (!supported.value) return 'unsupported';
  return 'preview';
};
</script>

<template>
  <div class="w-full h-screen bg-base overflow-hidden">
    <div v-if="isShowToolbar" class="p-6">
      <UrlInput
        v-model="inputUrl"
        :has-preview="hasPreview"
        @preview="handlePreview"
        @clear="handleClear"
      />
    </div>

    <div
      :class="isShowToolbar ? 'px-6 pb-6' : ''"
      class="w-full overflow-hidden"
      :style="{
        height: isShowToolbar ? 'calc(100vh - 104px)' : '100vh',
      }"
    >
      <div
        v-if="isShowToolbar"
        class="h-full w-full bg-container rounded-xl overflow-hidden relative"
      >
        <StatusDisplay v-if="getCurrentStatus() === 'empty'" type="empty" />

        <StatusDisplay
          v-else-if="getCurrentStatus() === 'unsupported'"
          type="unsupported"
          :file-url="fileUrl"
        />

        <StatusDisplay
          v-else-if="getCurrentStatus() === 'error'"
          type="error"
          :error-message="errorMessage"
          @reload="handleReload"
        />

        <FileViewer
          v-else
          ref="fileViewerRef"
          :file-url="fileUrl"
          @ready="handleReady"
          @load="handleLoad"
          @error="handleError"
        />
      </div>

      <div v-else class="h-full w-full overflow-hidden">
        <StatusDisplay v-if="getCurrentStatus() === 'empty'" type="empty" />

        <StatusDisplay
          v-else-if="getCurrentStatus() === 'unsupported'"
          type="unsupported"
          :file-url="fileUrl"
        />

        <StatusDisplay
          v-else-if="getCurrentStatus() === 'error'"
          type="error"
          :error-message="errorMessage"
          @reload="handleReload"
        />

        <FileViewer
          v-else
          ref="fileViewerRef"
          :file-url="fileUrl"
          @ready="handleReady"
          @load="handleLoad"
          @error="handleError"
        />
      </div>
    </div>
  </div>
</template>
