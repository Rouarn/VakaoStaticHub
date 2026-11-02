<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton, NIcon, NSelect, NProgress, useMessage } from 'naive-ui';
import { CloudUploadOutline, CloseOutline } from '@vicons/ionicons5';
import {
  cancelChunkUpload,
  completeChunkUpload,
  initChunkUpload,
  uploadChunk,
  uploadFiles,
} from '@/api/files';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import type { CategoryEntry } from '@/stores/modules/category';

/**
 * 上传面板：普通上传 + 5MB 分片断点续传
 *
 * 分片状态机：
 *   queued → (init) 读取 uploadedChunks → 仅补传缺失分片（并发 3，单分片重试 2 次）
 *        → complete 合并 → success
 *   任一步失败 → error（可重试）；用户取消 → 中止在途请求并调用 upload/cancel 清理临时分片
 *
 * 目标分类支持直接输入新名称（NSelect tag 模式）：后端在上传时 mkdir 隐式创建分类，
 * 这是当前唯一可用的「新建分类」途径。
 */
const props = defineProps<{
  rootId: string;
  category: string;
  categories: CategoryEntry[];
}>();

const emit = defineEmits<{
  uploaded: [];
  close: [];
}>();

const message = useMessage();

const CHUNK_SIZE = 5 * 1024 * 1024;
const CHUNK_THRESHOLD = 5 * 1024 * 1024;
const CONCURRENCY = 3;

interface UploadTask {
  id: string;
  file: File;
  percent: number;
  status: 'queued' | 'uploading' | 'success' | 'error' | 'canceled';
  message: string;
  chunked: boolean;
  resumed: boolean;
}

const tasks = ref<UploadTask[]>([]);
const targetCategory = ref(props.category);
const running = ref(false);
const controllers = new Map<string, AbortController>();
const uploadIds = new Map<string, string>();
let seq = 0;

const categoryOptions = computed(() =>
  props.categories.map((c) => ({ label: c.name, value: c.name })),
);

const fileInput = ref<HTMLInputElement | null>(null);

function pickFiles() {
  fileInput.value?.click();
}

function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0) return;
  files.forEach((file) => {
    tasks.value.push({
      id: `t${++seq}`,
      file,
      percent: 0,
      status: 'queued',
      message: '',
      chunked: file.size > CHUNK_THRESHOLD,
      resumed: false,
    });
  });
  void startQueue();
}

function updateProgress(task: UploadTask, percent: number) {
  task.percent = Math.min(99, Math.max(task.percent, Math.round(percent)));
}

async function uploadChunkWithRetry(
  uploadId: string,
  index: number,
  blob: Blob,
  onLoaded: (loaded: number) => void,
  signal: AbortSignal,
) {
  let attempt = 0;
  while (true) {
    try {
      await uploadChunk(uploadId, index, blob, onLoaded, signal);
      return;
    } catch (e) {
      if (signal.aborted) throw e;
      attempt += 1;
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function runPool<T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function uploadChunked(task: UploadTask, controller: AbortController) {
  const category = targetCategory.value;
  const init = await initChunkUpload({
    rootId: props.rootId,
    category,
    filename: task.file.name,
    size: task.file.size,
    chunkSize: CHUNK_SIZE,
  });
  uploadIds.set(task.id, init.uploadId);
  task.resumed = init.uploadedChunks.length > 0;

  const total = Math.max(1, Math.ceil(task.file.size / CHUNK_SIZE));
  const done = new Set(init.uploadedChunks);
  const partial = new Map<number, number>();

  const recompute = () => {
    let bytes = 0;
    for (const i of done) {
      bytes += Math.min(CHUNK_SIZE, task.file.size - i * CHUNK_SIZE);
    }
    for (const [i, loaded] of partial) {
      if (!done.has(i)) bytes += Math.min(loaded, CHUNK_SIZE);
    }
    updateProgress(task, (bytes / task.file.size) * 100);
  };
  recompute();

  const pending = Array.from({ length: total }, (_, i) => i).filter(
    (i) => !done.has(i),
  );

  await runPool(pending, CONCURRENCY, async (index) => {
    const start = index * CHUNK_SIZE;
    const chunk = task.file.slice(start, Math.min(start + CHUNK_SIZE, task.file.size));
    await uploadChunkWithRetry(
      init.uploadId,
      index,
      chunk,
      (loaded) => {
        partial.set(index, loaded);
        recompute();
      },
      controller.signal,
    );
    partial.delete(index);
    done.add(index);
    recompute();
  });

  await completeChunkUpload({
    uploadId: init.uploadId,
    rootId: props.rootId,
    category,
    filename: task.file.name,
    size: task.file.size,
  });
  task.percent = 100;
}

async function uploadOne(task: UploadTask): Promise<boolean> {
  task.status = 'uploading';
  task.message = '';
  const controller = new AbortController();
  controllers.set(task.id, controller);
  try {
    if (task.chunked) {
      await uploadChunked(task, controller);
    } else {
      await uploadFiles(
        props.rootId,
        targetCategory.value,
        [task.file],
        (percent) => updateProgress(task, percent),
        controller.signal,
      );
      task.percent = 100;
    }
    task.status = 'success';
    return true;
  } catch (e) {
    if (controller.signal.aborted) {
      task.status = 'canceled';
      task.message = '已取消';
    } else {
      task.status = 'error';
      task.message = getErrorMessage(e, '上传失败');
    }
    return false;
  } finally {
    controllers.delete(task.id);
    uploadIds.delete(task.id);
  }
}

async function startQueue() {
  if (running.value) return;
  running.value = true;
  let successCount = 0;
  try {
    const queued = tasks.value.filter((t) => t.status === 'queued');
    for (const task of queued) {
      if (await uploadOne(task)) successCount += 1;
    }
  } finally {
    running.value = false;
  }
  if (successCount > 0) {
    message.success(`已上传 ${successCount} 个文件到「${targetCategory.value}」`);
    emit('uploaded');
  }
  const failed = tasks.value.filter((t) => t.status === 'error');
  if (failed.length > 0) {
    message.error(`${failed.length} 个文件上传失败，可单独重试`);
  }
}

async function cancelTask(task: UploadTask) {
  controllers.get(task.id)?.abort();
  const uploadId = uploadIds.get(task.id);
  if (uploadId) {
    try {
      await cancelChunkUpload(uploadId);
    } catch {
      // 清理失败不影响前端状态
    }
  }
  if (task.status === 'queued') task.status = 'canceled';
}

async function retryTask(task: UploadTask) {
  task.status = 'queued';
  task.percent = 0;
  task.message = '';
  if (!running.value) void startQueue();
}

function removeTask(task: UploadTask) {
  void cancelTask(task);
  tasks.value = tasks.value.filter((t) => t.id !== task.id);
}

const hasActive = computed(() =>
  tasks.value.some((t) => t.status === 'queued' || t.status === 'uploading'),
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <span class="text-12px text-ink-sub shrink-0">目标分类</span>
      <NSelect
        v-model:value="targetCategory"
        :options="categoryOptions"
        filterable
        tag
        size="small"
        placeholder="选择或输入新分类（上传时自动创建）"
        class="flex-1"
      />
    </div>

    <div
      class="glass-card border-2 border-dashed border-brand-400/50 rounded-2xl px-6 py-8 flex flex-col items-center gap-2 cursor-pointer"
      @click="pickFiles"
    >
      <NIcon :size="34" class="text-brand-500 dark:text-brand-400">
        <CloudUploadOutline />
      </NIcon>
      <p class="m-0 text-13px text-ink">点击选择文件（支持多选）</p>
      <p class="m-0 text-11px text-ink-sub">
        大于 5MB 自动走分片断点续传，中断后再次上传会从已完成分片继续
      </p>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="hidden"
        @change="onFilesSelected"
      />
    </div>

    <div v-if="tasks.length" class="flex flex-col gap-2 max-h-70 overflow-y-auto pr-1">
      <div
        v-for="task in tasks"
        :key="task.id"
        class="glass-panel px-3 py-2 flex flex-col gap-1.5"
      >
        <div class="flex items-center gap-2">
          <span class="text-12px text-ink truncate flex-1" :title="task.file.name">
            {{ task.file.name }}
          </span>
          <span class="text-11px text-ink-sub shrink-0">
            {{ formatBytes(task.file.size) }}
          </span>
          <span
            v-if="task.chunked"
            class="glass-chip px-2 py-0.5 text-10px text-brand-600 dark:text-brand-400 shrink-0"
          >
            {{ task.resumed ? '已续传' : '分片' }}
          </span>
          <NButton
            v-if="task.status === 'uploading' || task.status === 'queued'"
            size="tiny"
            quaternary
            circle
            @click="cancelTask(task)"
          >
            <template #icon><NIcon :size="14"><CloseOutline /></NIcon></template>
          </NButton>
          <NButton
            v-else-if="task.status === 'error'"
            size="tiny"
            quaternary
            @click="retryTask(task)"
          >
            重试
          </NButton>
          <NButton v-else size="tiny" quaternary circle @click="removeTask(task)">
            <template #icon><NIcon :size="14"><CloseOutline /></NIcon></template>
          </NButton>
        </div>
        <NProgress
          type="line"
          :percentage="task.percent"
          :status="
            task.status === 'error'
              ? 'error'
              : task.status === 'success'
                ? 'success'
                : 'default'
          "
          :height="6"
          :show-indicator="false"
        />
        <p
          v-if="task.message"
          class="m-0 text-11px"
          :class="task.status === 'error' ? 'text-red-500' : 'text-ink-sub'"
        >
          {{ task.message }}
        </p>
      </div>
    </div>

    <div class="flex justify-end gap-2">
      <NButton size="small" quaternary @click="emit('close')">关闭</NButton>
      <NButton
        size="small"
        type="primary"
        :disabled="!hasActive"
        @click="startQueue"
      >
        {{ running ? '上传中…' : '开始上传' }}
      </NButton>
    </div>
  </div>
</template>
