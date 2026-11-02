<script setup lang="ts">
import { ShareSocialOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="分享管理"
    description="分享链接全生命周期管理：列表、二维码、有效期与访问次数控制。"
    :icon="ShareSocialOutline"
    :features="[
      '分享列表（含空状态）',
      '二维码生成（qrcode）',
      '密码 / 过期 / 次数限制配置',
      '访问拦截状态提示',
    ]"
  />
</template>
