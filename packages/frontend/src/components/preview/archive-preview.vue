<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { PreviewProps } from './types';
import { formatBytes } from '@/utils/file-types';
import { getExtension } from '@/utils/file-types';

/**
 * 压缩包预览：零依赖解析 ZIP 中央目录得到条目列表
 * 仅支持 zip（含 .jar/.apk 等同结构）；rar/7z 等无纯前端解析能力，只展示元信息
 */
const props = defineProps<PreviewProps>();

interface ArchiveEntry {
  name: string;
  compressed: number;
  original: number;
  dir: boolean;
}

const entries = ref<ArchiveEntry[]>([]);
const loading = ref(true);
const error = ref('');
const message = ref('');
const totalOriginal = computed(() =>
  entries.value.reduce((sum, e) => sum + (e.dir ? 0 : e.original), 0),
);

const ZIP_MAX_BYTES = 200 * 1024 * 1024;

async function parseZip(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  // 从尾部向前找 End Of Central Directory（最多回退 64KB 注释区）
  let eocd = -1;
  const floor = Math.max(0, buffer.byteLength - 65536);
  for (let i = buffer.byteLength - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（未找到目录区）');

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const list: ArchiveEntry[] = [];

  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buffer.byteLength) break;
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressed = view.getUint32(ptr + 20, true);
    const original = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    list.push({
      name,
      compressed,
      original,
      dir: name.endsWith('/'),
    });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return list;
}

onMounted(async () => {
  const ext = getExtension(props.filename);
  if (ext !== 'zip' && ext !== 'jar' && ext !== 'apk') {
    message.value = `.${ext} 格式不支持前端解析目录，仅展示元信息`;
    loading.value = false;
    return;
  }
  if (props.size > ZIP_MAX_BYTES) {
    message.value = `压缩包超过 ${formatBytes(ZIP_MAX_BYTES)}，已跳过条目解析`;
    loading.value = false;
    return;
  }
  try {
    const resp = await fetch(props.src);
    if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
    entries.value = await parseZip(await resp.arrayBuffer());
  } catch (e) {
    error.value = e instanceof Error ? e.message : '压缩包解析失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <p v-if="error" class="text-13px text-ink-sub">{{ error }}</p>
    <p v-else-if="loading" class="text-13px text-ink-sub">压缩包解析中…</p>
    <p v-else-if="message" class="text-13px text-ink-sub">{{ message }}</p>
    <template v-else>
      <p class="m-0 mb-2 text-12px text-ink-sub">
        {{ entries.length }} 个条目 · 解压后约 {{ formatBytes(totalOriginal) }}
      </p>
      <div class="flex-1 min-h-0 overflow-auto rounded-xl border border-glass-border dark:border-glass-border-dark">
        <table class="w-full border-collapse text-12px">
          <tbody>
            <tr
              v-for="entry in entries"
              :key="entry.name"
              class="odd:bg-white/40 dark:odd:bg-white/5"
            >
              <td class="px-3 py-1.5 truncate max-w-90">{{ entry.name }}</td>
              <td class="px-3 py-1.5 text-right whitespace-nowrap text-ink-sub">
                {{ entry.dir ? '—' : formatBytes(entry.original) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
