import { computed, ref, type Ref } from 'vue';

export interface ListLoadingOptions {
  /** 提示文案使用的页码；未传时按第一页处理 */
  page?: Ref<number>;
  /** 非翻页场景的提示文案，默认「正在加载…」 */
  text?: string;
}

/**
 * 列表加载态（全站唯一实现）
 *
 * 统一「切换时清空旧数据 → 进入加载态 → 中文提示文案」的规则：
 * - 翻页时文案带上目标页码，其余场景用通用文案
 * - 各列表页只调用 begin(reset) 并引用 ListLoading 组件，不要各自复制一份
 */
export function useListLoading(options: ListLoadingOptions = {}) {
  const loading = ref(false);

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

  return { loading, loadingText, begin };
}
