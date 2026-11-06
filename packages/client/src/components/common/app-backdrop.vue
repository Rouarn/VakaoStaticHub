<template>
  <!--
    壁纸层：固定在最底层，材质变量由 uno.config.ts 按 html[data-material] 提供。
    cool（管理端）= 冷灰蓝 + 大半径柔光斑；fluid（对外页）= 高饱和光斑 + 旋转极光。
    纯装饰，不接收指针事件。
  -->
  <div class="app-backdrop" aria-hidden="true">
    <div class="app-backdrop__wall" />
    <div class="app-backdrop__aurora" />
    <div class="app-backdrop__blob b1" />
    <div class="app-backdrop__blob b2" />
    <div class="app-backdrop__blob b3" />
    <div class="app-backdrop__blob b4" />
    <div class="app-backdrop__vignette" />
    <div class="app-backdrop__grain" />
  </div>
</template>
