<script setup lang="ts">
import { ChatbubbleOutline } from '@vicons/ionicons5';
import PlaceholderView from '@/components/common/placeholder-view.vue';
</script>

<template>
  <PlaceholderView
    title="一言"
    description="一言 API 接入与参数调试：分类、长度、编码实时试调。"
    :icon="ChatbubbleOutline"
    :features="['一言句子展示', '参数调试面板', 'API 地址复制']"
  />
</template>
