<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NCard,
  NForm,
  NFormItem,
  NInput,
  NButton,
  NAlert,
  NIcon,
} from 'naive-ui';
import { CloudOutline } from '@vicons/ionicons5';
import { useAuthStore } from '@/stores/modules/auth';
import { login } from '@/api/auth';
import { getErrorMessage } from '@/utils/request';

const username = ref('');
const password = ref('');
const errorMessage = ref('');
const loading = ref(false);

const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

function validate(): string {
  if (!username.value || !password.value) {
    return '请输入用户名和密码';
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
    const data = await login(username.value, password.value);
    authStore.setAuth(data.accessToken, data.user);
    const redirect = (route.query.redirect as string) || '/file-list';
    await router.replace(redirect);
  } catch (error) {
    authStore.clearAuth();
    errorMessage.value = getErrorMessage(error, '请求失败，请稍后重试');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-container px-4">
    <NCard class="max-w-md w-full shadow-xl rounded-2xl border-none bg-base">
      <div class="text-center mb-8">
        <div
          class="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-2xl mb-4"
        >
          <NIcon size="40" class="text-primary">
            <CloudOutline />
          </NIcon>
        </div>
        <h1 class="text-2xl font-bold text-base">StaticHub</h1>
        <p class="text-sm text-gray-500 mt-1">静态资源管理系统</p>
      </div>

      <NForm size="large">
        <NFormItem label="用户名">
          <NInput
            v-model:value="username"
            placeholder="请输入用户名"
            :maxlength="32"
          />
        </NFormItem>
        <NFormItem label="密码">
          <NInput
            v-model:value="password"
            type="password"
            placeholder="请输入密码"
            show-password-on="mousedown"
            @keyup.enter="handleSubmit"
          />
        </NFormItem>
        <NFormItem>
          <NButton
            id="submitBtn"
            type="primary"
            block
            :loading="loading"
            @click="handleSubmit"
          >
            {{ loading ? '登录中...' : '登录系统' }}
          </NButton>
        </NFormItem>

        <NAlert
          v-if="errorMessage"
          type="error"
          closable
          @close="errorMessage = ''"
        >
          {{ errorMessage }}
        </NAlert>
      </NForm>
    </NCard>
  </div>
</template>
