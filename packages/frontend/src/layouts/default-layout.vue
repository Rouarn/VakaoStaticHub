<script setup lang="ts">
import { RouterView } from 'vue-router';
import SystemSidebar from './components/system-sidebar.vue';
import PhotoBar from './components/photo-bar.vue';

/**
 * 管理端布局外壳
 *
 * - 壁纸与玻璃材质：App.vue 的 AppBackdrop + html[data-material="cool"]
 * - System Sidebar（72px）：系统级固定功能，纯图标 + Tooltip
 * - Category Panel（240px）：用户动态资源分类，独立玻璃面板 + 独立滚动
 * - Main Content：主内容区，路由过渡 + 独立滚动
 * - PhotoBar：底部状态栏，右侧「随机图片」入口（按当前根目录 / 分类生成地址）
 */

</script>

<template>
  <div class="page-bg text-ink relative h-full w-full overflow-hidden">
    <div class="relative h-full flex gap-4 p-4 box-border">
      <SystemSidebar />

      <!-- 主内容区 + 底部状态栏 -->
      <div class="min-w-0 min-h-0 flex-1 flex flex-col">
        <main class="min-w-0 min-h-0 flex-1 overflow-y-auto pb-2">
          <RouterView v-slot="{ Component }">
            <Transition name="fade-slide" mode="out-in">
              <component :is="Component" />
            </Transition>
          </RouterView>
        </main>
        <PhotoBar />
      </div>
    </div>
  </div>
</template>
