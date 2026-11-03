<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NInput, NIcon, useMessage } from 'naive-ui';
import {
  CloudOutline,
  PersonOutline,
  LockClosedOutline,
} from '@vicons/ionicons5';
import PublicPage from '@/components/common/public-page.vue';
import { login } from '@/api/auth';
import { getErrorMessage } from '@/utils/http';
import { useAuthStore } from '@/stores/modules/auth';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const loading = ref(false);
/** 用户名去空格后非空且密码非空才允许提交；为空时按钮禁用、回车静默忽略 */
const canSubmit = computed(
  () => username.value.trim().length > 0 && password.value.length > 0,
);

function submit() {
  if (loading.value || !canSubmit.value) return;
  void doLogin();
}

/** 回车与「登录」按钮共用同一校验：输入法组合中的回车不提交 */
function onEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  submit();
}

async function doLogin() {
  loading.value = true;
  try {
    const resp = await login(username.value.trim(), password.value);
    authStore.setAuth(resp);
    message.success(`欢迎回来，${resp.user.username}`);
    const redirect = route.query.redirect;
    void router.replace(
      typeof redirect === 'string' && redirect ? redirect : { name: 'files' },
    );
  } catch (error) {
    message.error(getErrorMessage(error, '登录失败，请稍后重试'));
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PublicPage>
    <div class="min-h-full flex items-center justify-center p-6">
      <div class="glass-panel animate-fade-up w-full max-w-95 px-8 py-10">
        <div class="mb-8 text-center">
          <div
            class="mx-auto mb-4 w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lift dark:shadow-lift-dark"
          >
            <NIcon :size="28"><CloudOutline /></NIcon>
          </div>
          <h1 class="m-0 text-xl font-600 text-ink">静态资源管理</h1>
          <p class="m-0 mt-1 text-12px text-ink-sub">
            Vakao Static Hub · 统一静态资源服务
          </p>
        </div>

        <div class="flex flex-col gap-4">
          <NInput
            v-model:value="username"
            size="large"
            placeholder="用户名"
            @keydown.enter.prevent="onEnter"
          >
            <template #prefix>
              <NIcon :size="16"><PersonOutline /></NIcon>
            </template>
          </NInput>
          <NInput
            v-model:value="password"
            size="large"
            type="password"
            show-password-on="click"
            placeholder="密码"
            @keydown.enter.prevent="onEnter"
          >
            <template #prefix>
              <NIcon :size="16"><LockClosedOutline /></NIcon>
            </template>
          </NInput>
          <NButton
            type="primary"
            size="large"
            block
            :loading="loading"
            :disabled="!canSubmit"
            @click="submit"
          >
            登 录
          </NButton>
        </div>

        <p class="m-0 mt-6 text-center text-11px text-ink-sub">
          账号由管理员在用户管理中创建
        </p>
      </div>
    </div>
  </PublicPage>
</template>
