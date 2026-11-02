<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NIcon, NSelect, NProgress, useMessage } from 'naive-ui';
import {
  CloudUploadOutline,
  CloseOutline,
  FolderOpenOutline,
} from '@vicons/ionicons5';
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
 * 上传面板（先选后传 + 拖拽/文件夹递归 + 分片断点续传）
 *
 * 状态机：
 *   queued（待上传，展示目标根/分类与大小）
 *     → 点「开始上传」才发请求
 *     → uploading（分片模式显示 已续传 标记 + 分片进度）
 *     → success / error（可重试）/ canceled
 *
 * 取消语义：中止在途请求 + 调 upload/cancel 清理临时分片目录，不伪造成功。
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

type TaskStatus = 'queued' | 'uploading' | 'success' | 'error' | 'canceled';

interface UploadTask {
  id: string;
  file: File;
  percent: number;
  status: TaskStatus;
  message: string;
  chunked: boolean;
  resumed: boolean;
  /** 进入队列时锁定的目标根/分类，避免上传中途切换目录导致落点漂移 */
  targetRootId: string;
  targetCategory: string;
  cancelRequested: boolean;
}

const tasks = ref<UploadTask[]>([]);
const targetCategory = ref(props.category);
const running = ref(false);
const cancelling = ref(false);
const cancelAllRequested = ref(false);
const controllers = new Map<string, AbortController>();
const uploadIds = new Map<string, string>();
let seq = 0;

const categoryOptions = computed(() =>
  props.categories.map((c) => ({ label: c.name, value: c.name })),
);

const fileInput = ref<HTMLInputElement | null>(null);
const dragDepth = ref(0);
const dragOver = computed(() => dragDepth.value > 0);

const queuedCount = computed(
  () => tasks.value.filter((t) => t.status === 'queued').length,
);
const activeCount = computed(
  () =>
    tasks.value.filter(
      (t) => t.status === 'queued' || t.status === 'uploading',
    ).length,
);

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '待上传',
  uploading: '上传中',
  success: '成功',
  error: '失败',
  canceled: '已取消',
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  queued: 'text-ink-sub',
  uploading: 'text-brand-600 dark:text-brand-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-500',
  canceled: 'text-ink-sub',
};

function pickFiles() {
  fileInput.value?.click();
}

function fileSignature(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

/** 加入待上传队列；重复文件（同名同大小同修改时间）自动去重 */
function enqueueFiles(files: File[]) {
  if (files.length === 0) return;
  const existing = new Set(
    tasks.value
      .filter((t) => t.status !== 'canceled')
      .map((t) => fileSignature(t.file)),
  );
  let duplicated = 0;
  let added = 0;
  for (const file of files) {
    const signature = fileSignature(file);
    if (existing.has(signature)) {
      duplicated += 1;
      continue;
    }
    existing.add(signature);
    tasks.value.push({
      id: `t${++seq}`,
      file,
      percent: 0,
      status: 'queued',
      message: '',
      chunked: file.size > CHUNK_THRESHOLD,
      resumed: false,
      targetRootId: props.rootId,
      targetCategory: targetCategory.value,
      cancelRequested: false,
    });
    added += 1;
  }
  if (duplicated > 0) {
    message.info(`已跳过 ${duplicated} 个重复文件`);
  }
  if (added === 0 && duplicated === 0) {
    message.warning('没有可上传的文件');
  }
}

function onFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  enqueueFiles(Array.from(input.files ?? []));
  input.value = '';
}

// —— 拖拽：多文件 + 文件夹递归（webkitGetAsEntry） ——
interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  file?: (
    success: (file: File) => void,
    error?: (err: unknown) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: EntryLike[]) => void,
      error?: (err: unknown) => void,
    ) => void;
  };
}

function readAllEntries(reader: {
  readEntries: (
    success: (entries: EntryLike[]) => void,
    error?: (err: unknown) => void,
  ) => void;
}): Promise<EntryLike[]> {
  return new Promise((resolve, reject) => {
    const all: EntryLike[] = [];
    const next = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(all);
            return;
          }
          all.push(...entries);
          next();
        },
        (err) => reject(err),
      );
    };
    next();
  });
}

async function walkEntry(entry: EntryLike, out: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    out.push(
      await new Promise<File>((resolve, reject) =>
        entry.file!(resolve, reject),
      ),
    );
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const children = await readAllEntries(entry.createReader());
    for (const child of children) {
      await walkEntry(child, out);
    }
  }
}

async function collectDropped(dataTransfer: DataTransfer): Promise<{
  files: File[];
  folders: number;
}> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((item) =>
      typeof item.webkitGetAsEntry === 'function'
        ? (item.webkitGetAsEntry() as unknown as EntryLike | null)
        : null,
    )
    .filter((entry): entry is EntryLike => Boolean(entry));

  if (entries.length > 0) {
    const files: File[] = [];
    let folders = 0;
    for (const entry of entries) {
      if (entry.isDirectory) folders += 1;
      await walkEntry(entry, files);
    }
    // 某些浏览器在 drop 时 items 为空壳，退回 files（不支持文件夹展开）
    if (files.length > 0 || folders > 0) return { files, folders };
  }
  return { files: Array.from(dataTransfer.files ?? []), folders: 0 };
}

async function onDrop(e: DragEvent) {
  e.preventDefault();
  dragDepth.value = 0;
  const dt = e.dataTransfer;
  if (!dt) return;
  try {
    const { files, folders } = await collectDropped(dt);
    if (folders > 0 && files.length === 0) {
      message.warning('文件夹为空或没有可读取的文件');
      return;
    }
    enqueueFiles(files);
    if (folders > 0) {
      message.success(
        `已从 ${folders} 个文件夹中读取 ${files.length} 个文件`,
      );
    }
  } catch {
    message.error('读取拖入内容失败，请改用点击选择');
  }
}

function onDragEnter(e: DragEvent) {
  e.preventDefault();
  dragDepth.value += 1;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(e: DragEvent) {
  e.preventDefault();
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

// 切换目标分类：仅同步「待上传」项，已开始/已完成的不改变落点
watch(targetCategory, (value) => {
  tasks.value.forEach((task) => {
    if (task.status === 'queued') task.targetCategory = value;
  });
});

function updateProgress(task: UploadTask, percent: number) {
  task.percent = Math.min(99, Math.max(task.percent, Math.round(percent)));
}

async function uploadChunkWithRetry(
  uploadId: string,
  index: number,
  blob: Blob,
  onLoaded: (loaded: number) => void,
  signal: AbortSignal,
  task: UploadTask,
) {
  let attempt = 0;
  while (true) {
    if (task.cancelRequested) throw new DOMException('Aborted', 'AbortError');
    try {
      await uploadChunk(uploadId, index, blob, onLoaded, signal);
      return;
    } catch (e) {
      if (signal.aborted || task.cancelRequested) throw e;
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
  const runners = Array.from(
    { length: Math.min(size, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

async function uploadChunked(task: UploadTask, controller: AbortController) {
  const category = task.targetCategory;
  const init = await initChunkUpload({
    rootId: task.targetRootId,
    category,
    filename: task.file.name,
    size: task.file.size,
    chunkSize: CHUNK_SIZE,
  });
  uploadIds.set(task.id, init.uploadId);

  // init 期间用户可能已取消：立即清理刚创建的临时分片目录
  if (task.cancelRequested) {
    await cancelChunkUpload(init.uploadId).catch(() => undefined);
    uploadIds.delete(task.id);
    throw new DOMException('Aborted', 'AbortError');
  }

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
    const chunk = task.file.slice(
      start,
      Math.min(start + CHUNK_SIZE, task.file.size),
    );
    await uploadChunkWithRetry(
      init.uploadId,
      index,
      chunk,
      (loaded) => {
        partial.set(index, loaded);
        recompute();
      },
      controller.signal,
      task,
    );
    partial.delete(index);
    done.add(index);
    recompute();
  });

  if (task.cancelRequested) {
    await cancelChunkUpload(init.uploadId).catch(() => undefined);
    uploadIds.delete(task.id);
    throw new DOMException('Aborted', 'AbortError');
  }

  await completeChunkUpload({
    uploadId: init.uploadId,
    rootId: task.targetRootId,
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
        task.targetRootId,
        task.targetCategory,
        [task.file],
        (percent) => updateProgress(task, percent),
        controller.signal,
      );
      task.percent = 100;
    }
    task.status = 'success';
    return true;
  } catch (e) {
    if (controller.signal.aborted || task.cancelRequested) {
      task.status = 'canceled';
      task.message = '已取消';
    } else {
      task.status = 'error';
      task.message = getErrorMessage(e, '上传失败');
    }
    return false;
  } finally {
    // 取消发生在 init 之后 / 取消请求先于 uploadId 写入的兜底清理
    if (task.cancelRequested) {
      const uploadId = uploadIds.get(task.id);
      if (uploadId) {
        await cancelChunkUpload(uploadId).catch(() => undefined);
      }
    }
    controllers.delete(task.id);
    uploadIds.delete(task.id);
  }
}

async function startQueue() {
  if (running.value) return;
  cancelAllRequested.value = false;
  running.value = true;
  let successCount = 0;
  let failedCount = 0;
  let canceledCount = 0;
  try {
    const queued = tasks.value.filter((t) => t.status === 'queued');
    for (const task of queued) {
      if (cancelAllRequested.value) break;
      const ok = await uploadOne(task);
      if (ok) successCount += 1;
      else if (task.status === 'error') failedCount += 1;
      else if (task.status === 'canceled') canceledCount += 1;
    }
  } finally {
    running.value = false;
  }

  if (successCount > 0) {
    emit('uploaded');
    message.success(
      `上传完成：成功 ${successCount} 个${
        failedCount > 0 ? `，失败 ${failedCount} 个` : ''
      }${canceledCount > 0 ? `，已取消 ${canceledCount} 个` : ''}`,
    );
  } else if (failedCount > 0) {
    message.error(`上传失败 ${failedCount} 个，可点击「重试」单独重试`);
  } else if (canceledCount > 0) {
    message.info('本次上传已取消');
  }
}

async function cancelTask(task: UploadTask) {
  task.cancelRequested = true;
  controllers.get(task.id)?.abort();
  const uploadId = uploadIds.get(task.id);
  if (uploadId) {
    try {
      await cancelChunkUpload(uploadId);
    } catch {
      // 清理失败不影响前端状态
    }
    uploadIds.delete(task.id);
  }
  if (task.status === 'queued') {
    task.status = 'canceled';
    task.message = '已取消';
  }
}

async function retryTask(task: UploadTask) {
  task.status = 'queued';
  task.percent = 0;
  task.message = '';
  task.cancelRequested = false;
  task.resumed = false;
  task.targetCategory = targetCategory.value;
  if (!running.value) void startQueue();
}

function removeTask(task: UploadTask) {
  if (task.status === 'uploading') {
    void cancelTask(task);
  }
  tasks.value = tasks.value.filter((t) => t.id !== task.id);
}

/** 整体取消：停止后续队列 + 中止在途请求 + 清理所有临时分片 */
async function cancelAll() {
  cancelAllRequested.value = true;
  cancelling.value = true;
  try {
    const active = tasks.value.filter(
      (t) => t.status === 'queued' || t.status === 'uploading',
    );
    active.forEach((task) => {
      task.cancelRequested = true;
      controllers.get(task.id)?.abort();
    });
    await Promise.all(
      active.map(async (task) => {
        const uploadId = uploadIds.get(task.id);
        if (!uploadId) return;
        try {
          await cancelChunkUpload(uploadId);
        } catch {
          // 清理失败不阻断其它任务
        }
        uploadIds.delete(task.id);
      }),
    );
    tasks.value.forEach((task) => {
      if (task.status === 'queued' || task.status === 'uploading') {
        task.status = 'canceled';
        task.message = '已取消';
      }
    });
    message.info('已取消本次上传，临时分片已清理');
  } finally {
    cancelling.value = false;
  }
}

async function clearAll() {
  // 只有确有在途上传时才需要调取消接口；
  // 纯待上传队列直接清空即可，不应弹出「已取消上传」提示。
  const hasUploading = tasks.value.some((task) => task.status === 'uploading');
  if (running.value || hasUploading) {
    await cancelAll();
  }
  tasks.value = [];
}
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
    <p class="m-0 text-11px text-ink-sub">
      当前目标根目录：<span class="text-ink">{{ rootId }}</span>
      ；切换分类只影响「待上传」项，已开始的项落点不变。
    </p>

    <div
      class="glass-card border-2 border-dashed rounded-2xl px-6 py-8 flex flex-col items-center gap-2 cursor-pointer transition-colors"
      :class="
        dragOver ? 'border-brand-500 bg-brand-500/10' : 'border-brand-400/50'
      "
      @click="pickFiles"
      @drop="onDrop"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
    >
      <NIcon :size="34" class="text-brand-500 dark:text-brand-400">
        <CloudUploadOutline />
      </NIcon>
      <p class="m-0 text-13px text-ink">
        点击选择，或拖拽文件/文件夹到此处
      </p>
      <p class="m-0 text-11px text-ink-sub text-center">
        拖入文件夹会递归读取内部文件并自动去重；选择后先列在下方，
        确认无误再点「开始上传」（大于 5MB 自动走分片断点续传）
      </p>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="hidden"
        @change="onFilesSelected"
      />
    </div>

    <div v-if="tasks.length" class="flex items-center justify-between">
      <p class="m-0 text-11px text-ink-sub">
        共 {{ tasks.length }} 项，待上传 {{ queuedCount }} 项
        <span v-if="running" class="text-brand-600 dark:text-brand-400">
          · 上传中…
        </span>
      </p>
      <div class="flex items-center gap-2">
        <NButton
          v-if="running || activeCount > 0"
          size="tiny"
          quaternary
          :loading="cancelling"
          @click="cancelAll"
        >
          取消全部
        </NButton>
        <NButton size="tiny" quaternary @click="clearAll">清空列表</NButton>
      </div>
    </div>

    <div
      v-if="tasks.length"
      class="flex flex-col gap-2 max-h-70 overflow-y-auto pr-1"
    >
      <div
        v-for="task in tasks"
        :key="task.id"
        class="glass-panel px-3 py-2 flex flex-col gap-1.5"
      >
        <div class="flex items-center gap-2">
          <NIcon
            :size="15"
            class="text-brand-600 dark:text-brand-400 shrink-0"
          >
            <FolderOpenOutline />
          </NIcon>
          <span
            class="text-12px text-ink truncate flex-1"
            :title="task.file.name"
          >
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
          <span
            class="text-10px shrink-0"
            :class="STATUS_CLASS[task.status]"
          >
            {{ STATUS_LABEL[task.status] }}
          </span>
          <NButton
            v-if="task.status === 'error'"
            size="tiny"
            quaternary
            @click="retryTask(task)"
          >
            重试
          </NButton>
          <NButton
            size="tiny"
            quaternary
            circle
            @click="removeTask(task)"
          >
            <template #icon><NIcon :size="14"><CloseOutline /></NIcon></template>
          </NButton>
        </div>
        <p class="m-0 text-10px text-ink-sub truncate">
          目标：{{ task.targetRootId }} / {{ task.targetCategory }}
        </p>
        <NProgress
          v-if="task.status !== 'queued' && task.status !== 'canceled'"
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
        :disabled="queuedCount === 0 || running"
        :loading="running"
        @click="startQueue"
      >
        {{ running ? '上传中…' : `开始上传${queuedCount > 0 ? `（${queuedCount}）` : ''}` }}
      </NButton>
    </div>
  </div>
</template>
