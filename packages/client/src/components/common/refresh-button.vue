<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import { CheckmarkOutline, RefreshOutline } from '@vicons/ionicons5';

/**
 * 列表页刷新按钮（全站唯一实现）
 *
 * 图标反馈：请求中让按钮自带的刷新图标旋转（不用 NButton 的 loading，
 * 后者会额外渲染一个圆环盖在图标上）；成功后短暂显示对勾再恢复箭头。
 * 两种图标共用同一尺寸与插槽，不新增 DOM、不改变按钮尺寸与占位，
 * 颜色继承按钮文字色，暗色/浅色下都清晰。
 */
withDefaults(
  defineProps<{
    loading?: boolean;
    success?: boolean;
    text?: string;
    quaternary?: boolean;
  }>(),
  { loading: false, success: false, text: '刷新', quaternary: true },
);

const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <NButton size="small" :quaternary="quaternary" @click="emit('click')">
    <template #icon>
      <NIcon v-if="success && !loading"><CheckmarkOutline /></NIcon>
      <NIcon v-else :class="{ 'refresh-spin': loading }">
        <RefreshOutline />
      </NIcon>
    </template>
    {{ text }}
  </NButton>
</template>

<style scoped>
.refresh-spin {
  animation: refresh-spin 900ms linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
