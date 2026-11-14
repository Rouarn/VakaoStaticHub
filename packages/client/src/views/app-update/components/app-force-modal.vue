<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NInputNumber, NModal, NSwitch, useMessage } from 'naive-ui';
import { setForceUpdate } from '@/api/app-update';
import type { AppVersionRecord } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';

/** 强更配置：forceUpdate 开关与最低版本号，可随时远程修改 */
const props = defineProps<{
  show: boolean;
  version: AppVersionRecord | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  done: [];
}>();

const message = useMessage();
const savingForce = ref(false);
const forceForm = ref({ forceUpdate: false, minVersionCode: 0 });

watch(
  () => props.show,
  (show) => {
    const version = props.version;
    if (!show || !version) return;
    forceForm.value = {
      forceUpdate: version.forceUpdate === 1,
      minVersionCode: version.minVersionCode,
    };
  },
  { immediate: true },
);

async function submitForce() {
  const target = props.version;
  if (!target) return;
  savingForce.value = true;
  try {
    await setForceUpdate(target.id, {
      forceUpdate: forceForm.value.forceUpdate,
      minVersionCode: forceForm.value.minVersionCode,
    });
    message.success('强更配置已更新');
    emit('update:show', false);
    emit('done');
  } catch (e) {
    message.error(getErrorMessage(e, '强更配置更新失败'));
  } finally {
    savingForce.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`强更配置 v${version?.versionName ?? ''}`"
    class="w-480px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <NSwitch v-model:value="forceForm.forceUpdate" size="small" />
        <span class="text-12px text-ink">强制更新（forceUpdate）</span>
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-12px text-ink-sub">最低版本号（minVersionCode）</span>
        <NInputNumber
          v-model:value="forceForm.minVersionCode"
          size="small"
          :min="0"
          :max="2147483647"
        />
      </label>
      <p class="m-0 text-11px text-ink-sub leading-5">
        客户端版本号低于 minVersionCode
        时也视为强制更新；该开关可随时远程修改，无需重新发版。
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="savingForce"
          @click="submitForce"
          >保存</NButton
        >
      </div>
    </template>
  </NModal>
</template>
