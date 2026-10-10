<script setup lang="ts">
import { ref } from 'vue';
import { NForm, NFormItem, NInput, NButton, NAlert } from 'naive-ui';
import { register } from '@/api/auth';
import { getErrorMessage } from '@/utils/request';

const emit = defineEmits<{
  (e: 'success', username: string): void;
}>();

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const errorMessage = ref('');
const loading = ref(false);

function validate(): string {
  if (!username.value || !password.value) {
    return '请输入用户名和密码';
  }
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username.value)) {
    return '用户名需为 3~32 位字母、数字、下划线或连字符';
  }
  if (password.value.length < 6 || password.value.length > 64) {
    return '密码长度需在 6~64 个字符之间';
  }
  if (password.value !== confirmPassword.value) {
    return '两次输入的密码不一致';
  }
  return '';
}

async function handleSubmit() {
  const validationError = validate();
  if (validationError) {
    errorMessage.value = validationError;
    return;
  }

  loading.value = true;
  errorMessage.value = '';

  try {
    await register(username.value, password.value);
    const created = username.value;
    username.value = '';
    password.value = '';
    confirmPassword.value = '';
    emit('success', created);
  } catch (error) {
    errorMessage.value = getErrorMessage(error, '创建失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <NForm size="large">
    <NFormItem label="用户名">
      <NInput
        v-model:value="username"
        placeholder="3~32 位字母、数字、下划线或连字符"
        :maxlength="32"
      />
    </NFormItem>
    <NFormItem label="密码">
      <NInput
        v-model:value="password"
        type="password"
        placeholder="6~64 个字符"
        show-password-on="mousedown"
        @keyup.enter="handleSubmit"
      />
    </NFormItem>
    <NFormItem label="确认密码">
      <NInput
        v-model:value="confirmPassword"
        type="password"
        placeholder="请再次输入密码"
        show-password-on="mousedown"
        @keyup.enter="handleSubmit"
      />
    </NFormItem>
    <NFormItem>
      <NButton type="primary" block :loading="loading" @click="handleSubmit">
        {{ loading ? '创建中...' : '创建用户' }}
      </NButton>
    </NFormItem>

    <NAlert
      v-if="errorMessage"
      type="error"
      closable
      class="mb-2"
      @close="errorMessage = ''"
    >
      {{ errorMessage }}
    </NAlert>
  </NForm>
</template>
