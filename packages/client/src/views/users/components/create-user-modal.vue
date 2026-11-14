<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui';
import type { UserInfo, UserRole } from '@vakao/shared';
import { createUser } from '@/api/users';
import { getErrorMessage } from '@/utils/http';

/**
 * 创建账号弹窗：用户名格式、密码长度与两次输入一致性在前端预校验；
 * 用户名重名检查依赖父级当前列表（后端仍会权威校验，创建 admin 仅管理员可操作）
 */
const props = defineProps<{
  show: boolean;
  isAdmin: boolean;
  users: UserInfo[];
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  created: [];
}>();

const message = useMessage();

const creating = ref(false);
const createError = ref('');
const createForm = reactive<{
  username: string;
  password: string;
  confirm: string;
  role: UserRole;
}>({ username: '', password: '', confirm: '', role: 'user' });

function reset() {
  createForm.username = '';
  createForm.password = '';
  createForm.confirm = '';
  createForm.role = 'user';
  createError.value = '';
}

watch(
  () => props.show,
  (show) => {
    if (show) reset();
  },
  { immediate: true },
);

function validateCreate(): string {
  const username = createForm.username.trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return '用户名需为 3~32 位字母、数字、下划线或连字符';
  }
  if (createForm.password.length < 6 || createForm.password.length > 64) {
    return '密码长度需在 6~64 个字符之间';
  }
  if (createForm.password !== createForm.confirm) {
    return '两次输入的密码不一致';
  }
  if (props.users.some((user) => user.username === username)) {
    return `用户名 ${username} 已存在`;
  }
  return '';
}

async function submitCreate() {
  const invalid = validateCreate();
  if (invalid) {
    createError.value = invalid;
    return;
  }
  creating.value = true;
  createError.value = '';
  try {
    const created = await createUser(
      createForm.username.trim(),
      createForm.password,
      createForm.role,
    );
    message.success(`账号 ${created.username} 已创建`);
    emit('update:show', false);
    emit('created');
  } catch (e) {
    createError.value = getErrorMessage(e, '创建账号失败');
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="创建账号"
    class="max-w-440px"
    :mask-closable="!creating"
    :closable="!creating"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">用户名</label>
        <NInput
          v-model:value="createForm.username"
          placeholder="3~32 位字母、数字、下划线或连字符"
          :maxlength="32"
          @keyup.enter="submitCreate"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">密码</label>
        <NInput
          v-model:value="createForm.password"
          type="password"
          show-password-on="click"
          placeholder="6~64 位"
          :maxlength="64"
          @keyup.enter="submitCreate"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">确认密码</label>
        <NInput
          v-model:value="createForm.confirm"
          type="password"
          show-password-on="click"
          placeholder="再次输入密码"
          :maxlength="64"
          @keyup.enter="submitCreate"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-12px text-ink-sub">角色</label>
        <NSelect
          v-model:value="createForm.role"
          :options="[
            { label: '普通用户（user）', value: 'user' },
            { label: '管理员（admin）', value: 'admin' },
          ]"
          :disabled="!isAdmin"
        />
        <p v-if="!isAdmin" class="m-0 text-11px text-ink-sub">
          仅管理员可以创建管理员账号，后端会拒绝提权请求
        </p>
      </div>
      <p v-if="createError" class="m-0 text-12px text-red-500">
        {{ createError }}
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton
          quaternary
          :disabled="creating"
          @click="emit('update:show', false)"
        >
          取消
        </NButton>
        <NButton type="primary" :loading="creating" @click="submitCreate">
          创建
        </NButton>
      </div>
    </template>
  </NModal>
</template>
