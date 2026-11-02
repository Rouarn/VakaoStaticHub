<script setup lang="ts">
import { PeopleOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="用户管理"
    description="管理员维护登录账号：列表、创建、删除。"
    :icon="PeopleOutline"
    :features="['用户列表', '创建账号', '删除用户']"
  />
</template>
