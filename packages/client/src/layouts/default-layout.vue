<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { NButton, NIcon } from 'naive-ui';
import { MenuOutline } from '@vicons/ionicons5';
import SystemSidebar from './components/system-sidebar.vue';
import PhotoBar from './components/photo-bar.vue';
import { refreshProfileOnce } from '@/composables/use-profile';

/**
 * 管理端布局外壳
 *
 * - ≥lg：240px 固定侧栏 + 主内容
 * - <lg：侧栏收成抽屉（遮罩 + 左滑），顶部显示移动栏（菜单按钮 + 品牌）
 * - 壁纸与玻璃材质：App.vue 的 AppBackdrop + html[data-material="cool"]
 */
const route = useRoute();
const mobileOpen = ref(false);

watch(
  () => route.fullPath,
  () => {
    mobileOpen.value = false;
  },
);

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') mobileOpen.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void refreshProfileOnce();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="page-bg text-ink relative h-full w-full overflow-hidden">
    <!-- 移动端抽屉遮罩 -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm lg:hidden"
      @click="mobileOpen = false"
    />

    <div
      class="relative h-full flex flex-col lg:flex-row gap-0 lg:gap-4 p-3 lg:p-4 box-border"
    >
      <!-- 侧栏：桌面固定，移动端抽屉 -->
      <div
        class="fixed inset-y-0 left-0 z-50 p-3 transition-transform duration-300 ease-out lg:static lg:z-auto lg:p-0 lg:translate-x-0"
        :class="mobileOpen ? 'translate-x-0' : '-translate-x-[110%]'"
      >
        <SystemSidebar />
      </div>

      <!-- 主内容区 + 底部状态栏 -->
      <div class="min-w-0 min-h-0 flex-1 flex flex-col">
        <!-- 移动端顶栏 -->
        <header class="lg:hidden flex items-center gap-2 pb-2 shrink-0">
          <NButton
            circle
            quaternary
            size="small"
            aria-label="打开导航"
            @click="mobileOpen = true"
          >
            <template #icon
              ><NIcon :size="18"><MenuOutline /></NIcon>
            </template>
          </NButton>
          <img
            src="/brand/star-four.svg"
            alt="VaKao"
            class="w-5 h-5 shrink-0 dark:hidden"
          />
          <img
            src="/brand/star-white.svg"
            alt="VaKao"
            class="w-5 h-5 shrink-0 hidden dark:block"
          />
          <span class="text-13px font-600 text-ink whitespace-nowrap"
            >Vakao Static Hub</span
          >
          <span class="ml-auto text-10px text-ink-sub whitespace-nowrap"
            >静态资源管理</span
          >
        </header>

        <main class="min-w-0 min-h-0 flex-1 overflow-y-auto pb-2">
          <!--
            路由过渡裁切层：页面入场时 animate-fade-up / fade-slide 会先向下平移 12px，
            这个平移会被计入 main 的可滚动溢出（即使页面本身 h-full 刚好占满一屏），
            导致每次切页右侧闪一下滚动条。这里用一层定高裁切把过渡位移挡在外壳内；
            所有管理页根节点都是 h-full，内容由各自的内部滚动区承载，裁切不影响其滚动。
          -->
          <div class="h-full min-h-0 overflow-hidden">
            <RouterView v-slot="{ Component }">
              <Transition name="fade-slide" mode="out-in">
                <component :is="Component" />
              </Transition>
            </RouterView>
          </div>
        </main>
        <PhotoBar />
      </div>
    </div>
  </div>
</template>
