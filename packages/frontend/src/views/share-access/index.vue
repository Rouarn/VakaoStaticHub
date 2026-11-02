<script setup lang="ts">
import { LockClosedOutline } from '@vicons/ionicons5';
import PublicPage from '@/components/common/public-page.vue';
import PlaceholderView from '@/components/common/placeholder-view.vue';

/**
 * 分享访问拦截页（/share/:token，公开）
 * 下一轮实现：密码校验、过期 / 次数限制提示、解锁后进入文件预览与下载。
 */
</script>

<template>
  <PublicPage>
    <PlaceholderView
      title="分享访问"
      description="分享链接访问拦截：密码校验、过期与次数限制提示，解锁后预览 / 下载。"
      :icon="LockClosedOutline"
      :features="['密码校验', '过期提示', '访问次数限制', '解锁后预览下载']"
    />
  </PublicPage>
</template>
