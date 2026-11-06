import { computed, onScopeDispose, ref, type Ref } from 'vue';
import { useMessage } from 'naive-ui';
import { getErrorMessage } from '@/utils/http';

export interface ListLoadingOptions {
  /** 提示文案使用的页码；未传时按第一页处理 */
  page?: Ref<number>;
  /** 非翻页场景的提示文案，默认「正在加载…」 */
  text?: string;
}

/** 刷新成功后对勾停留时长（毫秒） */
const SUCCESS_HOLD_MS = 1000;

/**
 * 列表加载态（全站唯一实现）
 *
 * 区分两种触发来源：
 * - begin(reset)：首次进入、翻页、切换筛选/排序/每页条数 → 立即显示遮罩
 * - refresh(task)：手动点「刷新」→ 不显示遮罩，只驱动页头刷新按钮的图标：
 *   请求中旋转，成功后短暂显示对勾（约 1 秒）再恢复箭头，失败则提示可读错误
 *
 * 各列表页只调用这两个入口并引用 ListLoading、RefreshButton，不要各自复制一套。
 */
export function useListLoading(options: ListLoadingOptions = {}) {
  const message = useMessage();
  const loading = ref(false);
  const refreshing = ref(false);
  /** 刷新成功后的对勾态，由 RefreshButton 消费 */
  const justRefreshed = ref(false);

  let successTimer: ReturnType<typeof setTimeout> | null = null;

  function clearJustRefreshed() {
    if (successTimer) {
      clearTimeout(successTimer);
      successTimer = null;
    }
    justRefreshed.value = false;
  }

  onScopeDispose(clearJustRefreshed);

  const loadingText = computed(() => {
    const page = options.page?.value ?? 1;
    if (page > 1) return `正在加载第 ${page} 页…`;
    return options.text ?? '正在加载…';
  });

  /** 进入加载态；reset 用于清空当前列表与选中项，避免旧数据在遮罩下残留 */
  function begin(reset?: () => void) {
    clearJustRefreshed();
    reset?.();
    loading.value = true;
  }

  /**
   * 手动刷新：不触碰遮罩，只驱动页头按钮的图标状态
   *
   * task 需要在「不显示遮罩、不清空旧数据」的前提下重新拉取，失败时抛出错误；
   * errorText 支持传入函数，便于按失败时的实际状态给出更准确的说明。
   */
  async function refresh(
    task: () => Promise<void>,
    errorText: string | (() => string) = '刷新失败',
  ) {
    if (refreshing.value) return;
    // 连点：立刻回到旋转态，避免对勾与旋转同时存在
    clearJustRefreshed();
    refreshing.value = true;
    try {
      await task();
      justRefreshed.value = true;
      successTimer = setTimeout(() => {
        justRefreshed.value = false;
        successTimer = null;
      }, SUCCESS_HOLD_MS);
    } catch (e) {
      const fallback =
        typeof errorText === 'function' ? errorText() : errorText;
      message.error(getErrorMessage(e, fallback));
    } finally {
      refreshing.value = false;
    }
  }

  return {
    loading,
    loadingText,
    refreshing,
    justRefreshed,
    begin,
    refresh,
  };
}
