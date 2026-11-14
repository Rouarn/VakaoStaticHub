<script setup lang="ts">
import { NButton, NIcon, NInput } from 'naive-ui';
import { EyeOutline, LockClosedOutline } from '@vicons/ionicons5';
import type { ShareInfo } from '@vakao/shared';
import ListLoading from '@/components/common/list-loading.vue';

/**
 * 分享访问门槛：展示分享摘要与访问密码表单。
 * 校验中遮罩在本区域内居中，不覆盖页头与页脚。
 */
defineProps<{
  info: ShareInfo;
  password: string;
  passwordError: string;
  expiresLabel: string;
  unlocking: boolean;
  rateLimited: boolean;
  loadingText: string;
}>();

const emit = defineEmits<{
  'update:password': [string];
  unlock: [];
}>();

function nameOf(path: string) {
  return path.split('/').pop() ?? path;
}
</script>

<template>
  <div class="relative flex flex-1 min-h-0 flex-col">
    <section class="glass-panel px-5 py-6 flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <p class="m-0 text-14px font-600 text-ink">
          {{
            info.shareType === 'collection'
              ? `文件集合（${info.filePaths.length} 个文件）`
              : nameOf(info.filePaths[0])
          }}
        </p>
        <p class="m-0 text-11px text-ink-sub">
          {{ info.category }} · {{ expiresLabel }}
          <template v-if="info.maxAccesses !== null">
            · 最多打开 {{ info.maxAccesses }} 次</template
          >
        </p>
      </div>

      <p v-if="passwordError" class="m-0 text-12px text-red-500 leading-5">
        {{ passwordError }}
      </p>

      <form
        v-if="info.hasPassword"
        class="flex flex-col gap-2"
        @submit.prevent="emit('unlock')"
      >
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">访问密码</span>
          <NInput
            :value="password"
            type="password"
            show-password-on="click"
            placeholder="请输入分享者设置的访问密码"
            size="large"
            :disabled="unlocking"
            @update:value="emit('update:password', $event)"
            @keyup.enter="emit('unlock')"
          />
        </label>
        <NButton
          type="primary"
          size="large"
          attr-type="submit"
          :loading="unlocking"
          :disabled="rateLimited"
        >
          <template #icon
            ><NIcon><LockClosedOutline /></NIcon
          ></template>
          验证并打开
        </NButton>
      </form>

      <div v-else class="flex flex-col gap-2">
        <p class="m-0 text-12px text-ink-sub">
          该分享未设置密码。打开会消耗 1 次打开次数（若分享者设置过上限）。
        </p>
        <NButton
          type="primary"
          size="large"
          :loading="unlocking"
          :disabled="rateLimited"
          @click="emit('unlock')"
        >
          <template #icon
            ><NIcon><EyeOutline /></NIcon
          ></template>
          打开分享
        </NButton>
      </div>
    </section>
    <ListLoading :show="unlocking" :text="loadingText" />
  </div>
</template>
