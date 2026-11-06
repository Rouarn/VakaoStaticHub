import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';

/**
 * 遮罩显示延迟（毫秒）：请求在此时限内完成则不显示遮罩，避免短请求一闪而过。
 * 与 list-loading.vue 的过渡时长配合使用，改这里即可统一调整全站遮罩出现的快慢。
 */
export const LIST_LOADING_SHOW_DELAY = 120;

/**
 * 把「加载中」布尔值转换成带延迟的遮罩可见状态（全站唯一实现）
 *
 * - 进入加载后延迟 delay 毫秒才置为可见；若期间已结束，则全程不显示，避免闪烁
 * - 从可见到隐藏立即翻转，由组件的 <Transition> 负责淡出；
 *   从未显示过就结束的场景不会触发淡出，直接跳过更自然
 */
export function useDelayedVisible(
  source: () => boolean,
  delay = LIST_LOADING_SHOW_DELAY,
) {
  const visible = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  watch(
    source,
    (on) => {
      clearTimeout(timer);
      if (on) {
        timer = setTimeout(() => {
          visible.value = true;
        }, delay);
      } else {
        visible.value = false;
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => clearTimeout(timer));

  return visible;
}

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
