<script setup lang="ts">
/**
 * 公开页外壳（登录 / 分享访问 / 独立预览页）
 *
 * 壁纸与玻璃材质由 App.vue 的 AppBackdrop + html[data-material="fluid"] 提供，
 * 这里只负责滚动容器，不再各自维护底色与光晕层。
 */
</script>

<template>
  <div class="text-ink relative h-full w-full overflow-hidden">
    <div class="relative h-full w-full overflow-y-auto">
      <slot />
    </div>
  </div>
</template>
