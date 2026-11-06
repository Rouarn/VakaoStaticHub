import { computed, ref, type Ref } from 'vue';
import { useMessage } from 'naive-ui';
import { getErrorMessage } from '@/utils/http';

export interface ListLoadingOptions {
  /** 提示文案使用的页码；未传时按第一页处理 */
  page?: Ref<number>;
  /** 非翻页场景的提示文案，默认「正在加载…」 */
  text?: string;
}

/**
 * 列表加载态（全站唯一实现）
 *
 * 区分两种触发来源：
 * - begin(reset)：首次进入、翻页、切换筛选/排序/每页条数 → 立即显示遮罩
 * - refresh(task, summary)：手动点「刷新」→ 不显示遮罩，只让按钮进入加载态，
 *   结束后统一提示「已刷新 · 当前 …」，失败则提示可读错误
 *
 * 各列表页只调用这两个入口并引用 ListLoading 组件，不要各自复制一套。
 */
export function useListLoading(options: ListLoadingOptions = {}) {
  const message = useMessage();
  const loading = ref(false);
  const refreshing = ref(false);

  const loadingText = computed(() => {
    const page = options.page?.value ?? 1;
    if (page > 1) return `正在加载第 ${page} 页…`;
    return options.text ?? '正在加载…';
  });

  /** 进入加载态；reset 用于清空当前列表与选中项，避免旧数据在遮罩下残留 */
  function begin(reset?: () => void) {
    reset?.();
    loading.value = true;
  }

  /**
   * 手动刷新：不触碰遮罩，只驱动页头按钮的加载态
   *
   * task 需要在「不显示遮罩、不清空旧数据」的前提下重新拉取，失败时抛出错误；
   * summary 返回本次刷新后的数据摘要（如「当前 12 个文件」）。
   */
  async function refresh(
    task: () => Promise<void>,
    summary: () => string,
    errorText = '刷新失败',
  ) {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
      await task();
      message.success(`已刷新 · ${summary()}`);
    } catch (e) {
      message.error(getErrorMessage(e, errorText));
    } finally {
      refreshing.value = false;
    }
  }

  return { loading, loadingText, refreshing, begin, refresh };
}
