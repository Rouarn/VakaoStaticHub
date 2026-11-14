<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { NButton, NInput, NModal, useMessage } from 'naive-ui';
import type { UserInfo } from '@vakao/shared';
import { changeMyPassword, resetUserPassword } from '@/api/users';
import { getErrorMessage } from '@/utils/http';

/**
 * 密码弹窗：mode=self 修改当前登录账号密码（需校验旧密码），
 * mode=other 由管理员重置他人密码；是否允许重置由父级提前拦截
 */
const props = defineProps<{
  show: boolean;
  mode: 'self' | 'other';
  target: UserInfo | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  saved: [];
}>();

const message = useMessage();

const passwordBusy = ref(false);
const passwordError = ref('');
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirm: '',
});

const passwordTitle = computed(() =>
  props.mode === 'self'
    ? '修改我的密码'
    : `重置「${props.target?.username ?? ''}」的密码`,
);

function reset() {
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirm = '';
  passwordError.value = '';
}

watch(
  () => props.show,
  (show) => {
    if (show) reset();
  },
  { immediate: true },
);

async function submitPassword() {
  if (props.mode === 'self' && !passwordForm.oldPassword) {
    passwordError.value = '请输入当前密码';
    return;
  }
  if (
    passwordForm.newPassword.length < 6 ||
    passwordForm.newPassword.length > 64
  ) {
    passwordError.value = '新密码长度需在 6~64 个字符之间';
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirm) {
    passwordError.value = '两次输入的新密码不一致';
    return;
  }
  passwordBusy.value = true;
  passwordError.value = '';
  try {
    if (props.mode === 'self') {
      await changeMyPassword(
        passwordForm.oldPassword,
        passwordForm.newPassword,
      );
      message.success('密码已修改');
    } else {
      const target = props.target;
      if (!target) return;
      await resetUserPassword(target.id, passwordForm.newPassword);
      message.success(`已重置「${target.username}」的密码`);
    }
    emit('update:show', false);
    emit('saved');
  } catch (e) {
    passwordError.value = getErrorMessage(e, '密码操作失败');
  } finally {
    passwordBusy.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="passwordTitle"
    class="max-w-440px"
    :mask-closable="!passwordBusy"
    :closable="!passwordBusy"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-3">
      <div v-if="mode === 'self'" class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">当前密码</label>
        <NInput
          v-model:value="passwordForm.oldPassword"
          type="password"
          show-password-on="click"
          placeholder="输入当前密码"
          :maxlength="64"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">新密码</label>
        <NInput
          v-model:value="passwordForm.newPassword"
          type="password"
          show-password-on="click"
          placeholder="6~64 位"
          :maxlength="64"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">确认新密码</label>
        <NInput
          v-model:value="passwordForm.confirm"
          type="password"
          show-password-on="click"
          placeholder="再次输入新密码"
          :maxlength="64"
          @keyup.enter="submitPassword"
        />
      </div>
      <p v-if="passwordError" class="m-0 text-12px text-red-500">
        {{ passwordError }}
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton
          quaternary
          :disabled="passwordBusy"
          @click="emit('update:show', false)"
        >
          取消
        </NButton>
        <NButton type="primary" :loading="passwordBusy" @click="submitPassword">
          保存
        </NButton>
      </div>
    </template>
  </NModal>
</template>
