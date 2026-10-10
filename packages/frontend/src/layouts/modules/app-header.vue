<script setup lang="ts">
import { computed, h, ref } from 'vue';
import {
  NButton,
  NIcon,
  NDropdown,
  NModal,
  NForm,
  NFormItem,
  NInput,
  useMessage,
  type DropdownOption,
} from 'naive-ui';
import {
  MenuOutline,
  CloudOutline,
  RefreshOutline,
  CloudUploadOutline,
  PersonCircleOutline,
  LogOutOutline,
  MoonOutline,
  SunnyOutline,
  EllipsisHorizontalOutline,
  KeyOutline,
  PeopleOutline,
} from '@vicons/ionicons5';
import { useDark, useToggle } from '@vueuse/core';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/modules/auth';
import { changePassword } from '@/api/auth';
import { getErrorMessage } from '@/utils/request';

const isDark = useDark();
const toggleDark = useToggle(isDark);

const authStore = useAuthStore();
const router = useRouter();
const message = useMessage();

const emit = defineEmits<{
  (e: 'toggleSidebar'): void;
  (e: 'refreshCache'): void;
  (e: 'openUploadModal'): void;
  (e: 'logout'): void;
}>();

const showPasswordModal = ref(false);
const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const passwordLoading = ref(false);

function resetPasswordForm() {
  oldPassword.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
}

async function submitChangePassword() {
  if (!oldPassword.value || !newPassword.value) {
    message.error('请输入当前密码和新密码');
    return;
  }
  if (newPassword.value.length < 6 || newPassword.value.length > 64) {
    message.error('新密码长度需在 6~64 个字符之间');
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    message.error('两次输入的新密码不一致');
    return;
  }
  passwordLoading.value = true;
  try {
    await changePassword(oldPassword.value, newPassword.value);
    showPasswordModal.value = false;
    resetPasswordForm();
    // 改密后所有已签发 token 失效，需重新登录
    message.success('密码修改成功，请重新登录');
    authStore.clearAuth();
    void router.push({ name: 'login' });
  } catch (error) {
    message.error(getErrorMessage(error, '密码修改失败'));
  } finally {
    passwordLoading.value = false;
  }
}

const mobileMenuOptions = computed<DropdownOption[]>(() => [
  {
    key: 'user-info',
    type: 'render',
    render: () =>
      h(
        'div',
        { class: 'flex items-center gap-2 px-2 py-1 text-sm text-base' },
        [
          h(NIcon, { size: 18 }, { default: () => h(PersonCircleOutline) }),
          h('span', authStore.userInfo?.username || '用户'),
        ],
      ),
  },
  { type: 'divider', key: 'divider-user' },
  {
    key: 'refresh',
    label: '刷新缓存',
    icon: () => h(NIcon, null, { default: () => h(RefreshOutline) }),
  },
  {
    key: 'theme',
    label: isDark.value ? '浅色模式' : '深色模式',
    icon: () =>
      h(NIcon, null, {
        default: () => h(isDark.value ? SunnyOutline : MoonOutline),
      }),
  },
  {
    key: 'user-management',
    label: '用户管理',
    icon: () => h(NIcon, null, { default: () => h(PeopleOutline) }),
  },
  {
    key: 'change-password',
    label: '修改密码',
    icon: () => h(NIcon, null, { default: () => h(KeyOutline) }),
  },
  { type: 'divider', key: 'divider-actions' },
  {
    key: 'logout',
    label: '退出登录',
    icon: () => h(NIcon, null, { default: () => h(LogOutOutline) }),
    props: { style: 'color: #d03050;' },
  },
]);

function handleMobileMenuSelect(key: string) {
  switch (key) {
    case 'refresh':
      emit('refreshCache');
      break;
    case 'theme':
      toggleDark();
      break;
    case 'user-management':
    case 'change-password':
    case 'logout':
      handleUserMenuSelect(key);
      break;
  }
}

/** 桌面端用户菜单：用户管理 / 修改密码 / 退出登录 */
const userMenuOptions: DropdownOption[] = [
  {
    key: 'user-management',
    label: '用户管理',
    icon: () => h(NIcon, null, { default: () => h(PeopleOutline) }),
  },
  {
    key: 'change-password',
    label: '修改密码',
    icon: () => h(NIcon, null, { default: () => h(KeyOutline) }),
  },
  {
    key: 'logout',
    label: '退出登录',
    icon: () => h(NIcon, null, { default: () => h(LogOutOutline) }),
    props: { style: 'color: #d03050;' },
  },
];

function handleUserMenuSelect(key: string) {
  if (key === 'user-management') {
    void router.push({ name: 'user-management' });
  } else if (key === 'change-password') {
    resetPasswordForm();
    showPasswordModal.value = true;
  } else if (key === 'logout') {
    emit('logout');
  }
}
</script>

<template>
  <header
    class="flex w-full items-center justify-between bg-base px-3 sm:px-6 z-10 border-b border-base"
  >
    <div class="flex items-center gap-3">
      <NButton
        quaternary
        circle
        size="small"
        class="md:hidden"
        @click="emit('toggleSidebar')"
      >
        <template #icon>
          <NIcon><MenuOutline /></NIcon>
        </template>
      </NButton>
      <div class="flex items-center gap-2 text-lg font-semibold text-base">
        <NIcon size="24" class="text-primary">
          <CloudOutline />
        </NIcon>
        <span>StaticHub</span>
      </div>
    </div>

    <div class="flex items-center justify-end gap-2 sm:gap-4">
      <NButton
        quaternary
        circle
        class="hidden text-gray-500 hover:bg-container transition-all sm:inline-flex"
        :title="isDark ? '切换到浅色模式' : '切换到深色模式'"
        @click="toggleDark()"
      >
        <template #icon>
          <NIcon>
            <MoonOutline v-if="isDark" />
            <SunnyOutline v-else />
          </NIcon>
        </template>
      </NButton>

      <NButton
        quaternary
        class="hidden border border-base text-gray-500 hover:bg-container transition-all sm:inline-flex"
        title="刷新文件缓存"
        @click="emit('refreshCache')"
      >
        <template #icon>
          <NIcon><RefreshOutline /></NIcon>
        </template>
        <span class="hidden sm:inline">刷新缓存</span>
      </NButton>

      <NButton
        type="primary"
        class="bg-primary hover:bg-primary_hover transition-all"
        @click="emit('openUploadModal')"
      >
        <template #icon>
          <NIcon><CloudUploadOutline /></NIcon>
        </template>
        <span class="hidden sm:inline">上传文件</span>
      </NButton>

      <NDropdown
        :options="userMenuOptions"
        trigger="click"
        placement="bottom-end"
        @select="handleUserMenuSelect"
      >
        <div
          class="hidden items-center gap-2 border-l border-base ml-2 sm:flex cursor-pointer"
        >
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <NIcon><PersonCircleOutline /></NIcon>
          </div>
          <span class="hidden sm:inline text-sm font-medium text-base">
            {{ authStore.userInfo?.username || '用户' }}
          </span>
        </div>
      </NDropdown>

      <NDropdown
        :options="mobileMenuOptions"
        trigger="click"
        placement="bottom-end"
        @select="handleMobileMenuSelect"
      >
        <NButton
          quaternary
          circle
          class="text-gray-500 hover:bg-container transition-all sm:hidden"
          title="更多操作"
        >
          <template #icon>
            <NIcon><EllipsisHorizontalOutline /></NIcon>
          </template>
        </NButton>
      </NDropdown>
    </div>

    <NModal
      v-model:show="showPasswordModal"
      preset="card"
      title="修改密码"
      class="max-w-md w-full"
    >
      <NForm size="large">
        <NFormItem label="当前密码">
          <NInput
            v-model:value="oldPassword"
            type="password"
            placeholder="请输入当前密码"
            show-password-on="mousedown"
          />
        </NFormItem>
        <NFormItem label="新密码">
          <NInput
            v-model:value="newPassword"
            type="password"
            placeholder="6~64 个字符"
            show-password-on="mousedown"
          />
        </NFormItem>
        <NFormItem label="确认新密码">
          <NInput
            v-model:value="confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password-on="mousedown"
            @keyup.enter="submitChangePassword"
          />
        </NFormItem>
        <div class="flex justify-end gap-2">
          <NButton @click="showPasswordModal = false">取消</NButton>
          <NButton
            type="primary"
            :loading="passwordLoading"
            @click="submitChangePassword"
          >
            确认修改
          </NButton>
        </div>
      </NForm>
    </NModal>
  </header>
</template>
