<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { NSpin, NTabs, NTabPane } from 'naive-ui';
import * as XLSX from 'xlsx';
import { fetchText } from '@/utils/text-decode';
import { getFileExtension } from '@/utils/file-types';

interface Props {
  /** 表格文件直链（xls/xlsx/csv） */
  src: string;
  /** 用于区分 csv 的文件名，缺省时从 src 路径推断 */
  filename?: string;
}

interface Emits {
  (e: 'ready'): void;
  (e: 'load'): void;
  (e: 'error', error: Error): void;
}

interface SheetItem {
  name: string;
  html: string;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const loading = ref(true);
const sheets = ref<SheetItem[]>([]);
const activeSheet = ref('');
// 异步加载与 src 切换的竞态守卫：每次加载递增，回调时校验
let loadGeneration = 0;

const activeHtml = computed(
  () => sheets.value.find((s) => s.name === activeSheet.value)?.html || '',
);

const resolveFilename = () => {
  if (props.filename) return props.filename;
  try {
    return new URL(props.src).pathname.split('/').pop() || props.src;
  } catch {
    return props.src;
  }
};

/**
 * sheet_to_html 对含超链接的单元格会原样拼接 href（未转义），
 * 存在 javascript: 伪协议 XSS 风险。预览不需要可点链接，移除全部 <a>。
 */
const sheetToSafeHtml = (ws: XLSX.WorkSheet): string => {
  const raw = XLSX.utils.sheet_to_html(ws, { header: '', footer: '' });
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return '';
  table.querySelectorAll('a').forEach((a) => {
    a.replaceWith(...Array.from(a.childNodes));
  });
  return table.outerHTML;
};

const init = async () => {
  if (!props.src) return;

  loading.value = true;
  const generation = ++loadGeneration;

  try {
    let workbook: XLSX.WorkBook;
    if (getFileExtension(resolveFilename()) === 'csv') {
      // csv 按文本读取，UTF-8/GBK 自动解码
      workbook = XLSX.read(await fetchText(props.src), { type: 'string' });
    } else {
      const res = await fetch(props.src);
      if (!res.ok) throw new Error(`文件加载失败（HTTP ${res.status}）`);
      workbook = XLSX.read(await res.arrayBuffer(), { type: 'array' });
    }
    if (generation !== loadGeneration) return;

    sheets.value = workbook.SheetNames.map((name) => ({
      name,
      html: sheetToSafeHtml(workbook.Sheets[name]),
    }));
    activeSheet.value = workbook.SheetNames[0] || '';
    loading.value = false;
    emit('ready');
    emit('load');
  } catch (error) {
    if (generation !== loadGeneration) return;
    loading.value = false;
    emit('error', error instanceof Error ? error : new Error('表格解析失败'));
  }
};

onMounted(init);

watch(
  () => props.src,
  (src, oldSrc) => {
    if (src && src !== oldSrc) {
      sheets.value = [];
      init();
    }
  },
);

onUnmounted(() => {
  loadGeneration++;
});

defineExpose({
  reload: init,
});
</script>

<template>
  <div class="xlsx-preview relative w-full h-full flex flex-col bg-base overflow-hidden">
    <NTabs
      v-if="sheets.length > 1"
      v-model:value="activeSheet"
      type="line"
      size="small"
      class="shrink-0 px-3"
    >
      <NTabPane
        v-for="sheet in sheets"
        :key="sheet.name"
        :name="sheet.name"
        :tab="sheet.name"
      />
    </NTabs>

    <div class="sheet-table flex-1 overflow-auto p-3">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-html="activeHtml" />
    </div>

    <div
      v-if="loading"
      class="absolute inset-0 bg-base/80 flex items-center justify-center z-10"
    >
      <NSpin :show="loading" size="large">
        <template #description>加载中...</template>
      </NSpin>
    </div>
  </div>
</template>

<style scoped>
.sheet-table :deep(table) {
  border-collapse: collapse;
  font-size: 13px;
  background: transparent;
}

.sheet-table :deep(td) {
  padding: 4px 10px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
