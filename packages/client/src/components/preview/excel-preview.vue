<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PreviewProps } from './types';
import { formatBytes } from '@/utils/file-types';

/**
 * Excel 预览：xlsx 解析为二维数组后自行渲染表格
 * 不使用 sheet_to_html，避免把单元格里的 HTML 直接注入页面
 */
const props = defineProps<PreviewProps>();

interface SheetView {
  name: string;
  rows: string[][];
  truncated: boolean;
}

const sheets = ref<SheetView[]>([]);
const active = ref(0);
const loading = ref(true);
const error = ref('');

const MAX_ROWS = 300;
const MAX_COLS = 40;

onMounted(async () => {
  try {
    const resp = await fetch(props.src);
    if (!resp.ok) throw new Error(`请求失败（HTTP ${resp.status}）`);
    const buffer = await resp.arrayBuffer();
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    sheets.value = wb.SheetNames.map((name) => {
      const sheet = wb.Sheets[name];
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
      });
      const truncated = raw.length > MAX_ROWS;
      const rows = raw
        .slice(0, MAX_ROWS)
        .map((row) =>
          Array.from(
            { length: Math.min(MAX_COLS, (row as unknown[]).length) },
            (_, i) => String((row as unknown[])[i] ?? ''),
          ),
        );
      return { name, rows, truncated };
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Excel 解析失败';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="w-full h-full flex flex-col">
    <p v-if="error" class="text-13px text-ink-sub">{{ error }}</p>
    <p v-else-if="loading" class="text-13px text-ink-sub">表格解析中…</p>
    <template v-else>
      <div class="mb-2 flex items-center gap-1 overflow-x-auto">
        <button
          v-for="(sheet, idx) in sheets"
          :key="sheet.name"
          class="glass-chip px-3 py-1 text-12px cursor-pointer border-none whitespace-nowrap"
          :class="{
            'text-brand-600 dark:text-brand-400 font-600': idx === active,
          }"
          @click="active = idx"
        >
          {{ sheet.name }}
        </button>
        <span class="ml-auto text-11px text-ink-sub pl-3">
          {{ formatBytes(props.size) }}
        </span>
      </div>
      <div
        class="flex-1 min-h-0 overflow-auto rounded-xl border border-glass-border dark:border-glass-border-dark"
      >
        <table class="w-full border-collapse text-12px">
          <tbody>
            <tr
              v-for="(row, r) in sheets[active]?.rows ?? []"
              :key="r"
              class="odd:bg-white/40 dark:odd:bg-white/5"
            >
              <td
                v-for="(cell, c) in row"
                :key="c"
                class="px-2 py-1 border border-glass-border dark:border-glass-border-dark whitespace-nowrap max-w-60 truncate"
              >
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="sheets[active]?.truncated"
        class="m-0 mt-2 text-11px text-ink-sub"
      >
        仅展示前 {{ MAX_ROWS }} 行 / {{ MAX_COLS }} 列
      </p>
    </template>
  </div>
</template>
