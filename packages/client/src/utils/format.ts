import dayjs from 'dayjs';

/** 通用展示格式化（时间 / 运行时长 / 百分比） */

/** 毫秒时间戳 → YYYY-MM-DD HH:mm:ss；空值显示破折号 */
export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return dayjs(ms).format('YYYY-MM-DD HH:mm:ss');
}

/** 毫秒时间戳 → YYYY-MM-DD；空值显示破折号 */
export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  return dayjs(ms).format('YYYY-MM-DD');
}

/** 进程运行秒数 → 天/时/分 */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 秒';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${Math.floor(seconds % 60)} 秒`;
  return `${Math.floor(seconds)} 秒`;
}

/**
 * 计算百分比并保留一位小数；total 为 0 时返回 0，
 * 供进度条等场景直接使用。
 */
export function percentOf(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

/** 从中间截断长文本（保留头尾），长度不足时不处理 */
export function truncateMiddle(text: string, head = 10, tail = 8): string {
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
