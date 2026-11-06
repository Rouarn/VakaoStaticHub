<script setup lang="ts">
import { NSpin } from 'naive-ui';
import { useDelayedVisible } from '@/composables/use-list-loading';

/**
 * 列表加载遮罩（全站唯一实现）
 *
 * 覆盖父级内容区的可视范围，让转圈与提示在垂直、水平方向居中。
 * 父容器需带 relative 与明确高度（如 flex-1 min-h-0），居中不随内容高度或滚动位置偏移。
 *
 * 遮罩底色统一取 CSS 变量 --mask-loading（定义在 design-tokens 的 colors.overlay，
 * 由 uno.config.ts 输出到 :root / html.dark），组件内不要再写死白/黑色值。
 *
 * 显示/隐藏动画：延迟 120ms 才淡入（短请求不闪遮罩），隐藏时 150ms 淡出；
 * 时长、曲线与延迟都收敛在本组件与 use-list-loading 中，各页面不要单独实现。
 */
const props = defineProps<{
  show: boolean;
  /** 中文加载提示，统一由 useListLoading 生成 */
  text: string;
}>();

const visible = useDelayedVisible(() => props.show);
</script>

<template>
  <Transition name="list-loading">
    <div
      v-if="visible"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--mask-loading)] backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
    >
      <NSpin size="large" />
      <p class="m-0 text-13px text-ink-sub">{{ text }}</p>
    </div>
  </Transition>
</template>

<style scoped>
/* 淡入 180ms、淡出 150ms，配合 2% 轻微缩放，避免生硬跳变 */
.list-loading-enter-active {
  transition:
    opacity 180ms ease-out,
    transform 180ms ease-out;
}

.list-loading-leave-active {
  transition:
    opacity 150ms ease-out,
    transform 150ms ease-out;
  /* 淡出期间不再拦截点击，隐藏后节点整体移除 */
  pointer-events: none;
}

.list-loading-enter-from,
.list-loading-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
