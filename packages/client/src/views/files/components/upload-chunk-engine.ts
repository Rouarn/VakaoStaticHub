import {
  cancelChunkUpload,
  completeChunkUpload,
  initChunkUpload,
  uploadChunk,
} from '@/api/files';

/**
 * 分片上传引擎：初始化 → 并发写入缺失分片（失败重试 1 次）→ 合并校验。
 * 仅负责分片传输本身；队列状态与提示由上传面板维护。
 */
export interface ChunkUploadTask {
  id: string;
  file: File;
  targetRootId: string;
  targetCategory: string;
  percent: number;
  resumed: boolean;
  cancelRequested: boolean;
}

const CHUNK_SIZE = 5 * 1024 * 1024;
const CONCURRENCY = 3;

async function uploadChunkWithRetry(
  uploadId: string,
  index: number,
  blob: Blob,
  onLoaded: (loaded: number) => void,
  signal: AbortSignal,
  task: ChunkUploadTask,
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

export async function uploadChunked(
  task: ChunkUploadTask,
  controller: AbortController,
  onProgress: (task: ChunkUploadTask, percent: number) => void,
  uploadIds: Map<string, string>,
) {
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
    onProgress(task, (bytes / task.file.size) * 100);
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
