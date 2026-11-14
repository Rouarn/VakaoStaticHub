<script setup lang="ts">
import { NButton, NIcon } from 'naive-ui';
import {
  ArrowBackOutline,
  BanOutline,
  DocumentTextOutline,
  LockClosedOutline,
  RefreshOutline,
  TimeOutline,
} from '@vicons/ionicons5';
import EmptyState from '@/components/common/empty-state.vue';
import type { ShareAccessPhase } from './types';

/** 分享不可用态：链接不存在 / 加载失败 / 已停用 / 已过期 / 次数用尽 */
defineProps<{
  phase: ShareAccessPhase;
  errorText: string;
}>();

const emit = defineEmits<{
  retry: [];
  back: [];
}>();
</script>

<template>
  <EmptyState
    v-if="phase === 'notfound'"
    :icon="DocumentTextOutline"
    title="分享链接不存在或已被撤销"
    description="请确认链接是否完整（token 为 32 位十六进制字符），或联系分享者重新生成。"
  >
    <NButton size="small" @click="emit('back')">
      <template #icon
        ><NIcon><ArrowBackOutline /></NIcon
      ></template>
      返回首页
    </NButton>
  </EmptyState>

  <EmptyState
    v-else-if="phase === 'error'"
    :icon="RefreshOutline"
    title="分享信息加载失败"
    :description="errorText"
  >
    <NButton size="small" type="primary" @click="emit('retry')">
      <template #icon
        ><NIcon><RefreshOutline /></NIcon
      ></template>
      重试
    </NButton>
  </EmptyState>

  <EmptyState
    v-else-if="phase === 'disabled'"
    :icon="BanOutline"
    title="分享链接已停用"
    description="分享者已停用该链接，无法继续访问。请联系分享者重新启用或重新创建链接。"
  />

  <EmptyState
    v-else-if="phase === 'expired'"
    :icon="TimeOutline"
    title="分享链接已过期"
    description="该链接的有效期已结束，无法继续访问。请联系分享者重新创建并获取新链接。"
  />

  <EmptyState
    v-else
    :icon="LockClosedOutline"
    title="分享链接打开次数已达上限"
    description="分享者设置了最大打开次数，当前次数已用尽。请联系分享者调整或重新创建链接。"
  />
</template>
