<script setup lang="ts">
import { computed } from 'vue';
import { NIcon, NTooltip } from 'naive-ui';
import { ImagesOutline, OpenOutline } from '@vicons/ionicons5';
import { useAppStore } from '@/stores/modules/app';
import { useCategoryStore } from '@/stores/modules/category';
import { buildRandomPhotoUrl } from '@/utils/file-url';

/**
 * 布局底部状态栏（恢复旧版右下角的「随机图片」入口）
 *
 * - 左侧：当前根目录 / 分类，随切换实时变化，避免用户忘记自己在看哪个分类
 * - 右侧：在新标签页打开 `<origin>/static/photo?rootId=<根目录>&category=<分类>`
 *   参数由 computed 实时计算，切换根目录 / 分类后再点，地址随之变化
 *
 * 为什么用真实链接而不是 window.open 复用窗口：
 * `/static/photo` 响应带 `Cross-Origin-Opener-Policy: same-origin`，
 * 该头会切断 opener 关系，window.open 对这类地址恒返回 null，无法复用；
 * 用 <a target="_blank"> 至少保证是「新标签页」而不是越开越多的小窗口，
 * 同时支持中键 / 键盘打开，也避免把「已被 COOP 切断」误报成「被拦截」。
 */
const appStore = useAppStore();
const categoryStore = useCategoryStore();

const category = computed(() => categoryStore.activeCategory ?? '');
const rootName = computed(() => categoryStore.rootName(appStore.activeRootId));

/** 目标地址（随根目录 / 分类变化） */
const photoUrl = computed(() =>
  buildRandomPhotoUrl({
    rootId: appStore.activeRootId,
    category: category.value || null,
  }),
);

/** Tooltip 里展示去掉 origin 的路径，参数变化肉眼可见 */
const photoPath = computed(() =>
  photoUrl.value.replace(/^https?:\/\/[^/]+/, ''),
);
</script>

<template>
  <footer
    class="shrink-0 flex items-center gap-2 h-8 px-1 text-11px select-none"
  >
    <div class="flex items-center gap-1.5 min-w-0 text-ink-sub">
      <span class="truncate max-w-24 sm:max-w-40" :title="rootName">{{ rootName }}</span>
      <span class="opacity-40">/</span>
      <span class="truncate max-w-28 sm:max-w-44" :title="category || '全部分类'">
        {{ category || '全部分类' }}
      </span>
    </div>

    <div class="flex-1" />

    <NTooltip placement="top-end" :delay="200">
      <template #trigger>
        <a
          :href="photoUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="photo-entry group flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full no-underline cursor-pointer border border-solid border-glass-border dark:border-glass-border-dark bg-white/45 dark:bg-white/6 text-ink-sub transition-all duration-200 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-white/75 dark:hover:bg-white/12 hover:-translate-y-px"
          :title="photoPath"
          aria-label="在新标签页打开随机图片"
        >
          <NIcon
            :size="14"
            class="transition-transform duration-200 group-hover:scale-110"
          >
            <ImagesOutline />
          </NIcon>
          <span class="whitespace-nowrap">随机图片</span>
          <NIcon :size="11" class="opacity-45">
            <OpenOutline />
          </NIcon>
        </a>
      </template>
      {{ photoPath }}
    </NTooltip>
  </footer>
</template>
