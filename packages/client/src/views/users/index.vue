<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  NButton,
  NIcon,
  NInput,
  NModal,
  NPagination,
  NSelect,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  KeyOutline,
  LockClosedOutline,
  PeopleOutline,
  PersonAddOutline,
  RefreshOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { UserInfo, UserRole } from '@vakao/shared';
import {
  changeMyPassword,
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
} from '@/api/users';
import { getErrorMessage } from '@/utils/http';
import { formatDateTime } from '@/utils/format';
import { useAuthStore } from '@/stores/modules/auth';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import ListLoading from '@/components/common/list-loading.vue';
import { useListLoading } from '@/composables/use-list-loading';

/**
 * 用户管理
 *
 * 服务端能力：
 * - 角色 admin / user；创建 admin 仅管理员可操作
 * - PATCH /auth/users/:id/password 管理员重置他人密码
 * - 删除权威校验：不能删自己、至少保留一个管理员
 */
const message = useMessage();
const authStore = useAuthStore();

const isAdmin = computed(() => authStore.user?.role === 'admin');
const adminCount = computed(
  () => users.value.filter((user) => user.role === 'admin').length,
);

const ROLE_META: Record<
  UserRole,
  { label: string; type: 'success' | 'default' }
> = {
  admin: { label: '管理员', type: 'success' },
  user: { label: '普通用户', type: 'default' },
};

const users = ref<UserInfo[]>([]);
/** 加载态与中文提示：文案规则见 useListLoading */
const { loading, loadingText } = useListLoading();
const error = ref('');

const page = ref(1);
const pageSize = ref(10);

const pagedUsers = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return users.value.slice(start, start + pageSize.value);
});

const currentUserId = computed(() => authStore.user?.id ?? -1);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    users.value = await listUsers();
    page.value = Math.min(
      page.value,
      Math.max(1, Math.ceil(users.value.length / pageSize.value)),
    );
  } catch (e) {
    error.value = getErrorMessage(e, '用户列表加载失败');
    users.value = [];
  } finally {
    loading.value = false;
  }
}

watch(pageSize, () => {
  page.value = 1;
});

// ===================== 创建账号 =====================

const createShow = ref(false);
const creating = ref(false);
const createError = ref('');
const createForm = reactive<{
  username: string;
  password: string;
  confirm: string;
  role: UserRole;
}>({ username: '', password: '', confirm: '', role: 'user' });

function openCreate() {
  createForm.username = '';
  createForm.password = '';
  createForm.confirm = '';
  createForm.role = 'user';
  createError.value = '';
  createShow.value = true;
}

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
  if (users.value.some((user) => user.username === username)) {
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
    createShow.value = false;
    await load();
  } catch (e) {
    createError.value = getErrorMessage(e, '创建账号失败');
  } finally {
    creating.value = false;
  }
}

// ===================== 删除账号 =====================

const deleteTarget = ref<UserInfo | null>(null);
const deleting = ref(false);

/** 删除拦截原因：为空表示允许删除（后端仍会权威校验，这里只做提前提示） */
function deleteBlockReason(user: UserInfo): string {
  if (user.id === currentUserId.value) {
    return '不能删除当前登录账号';
  }
  if (user.role === 'admin' && adminCount.value <= 1) {
    return '至少保留一个管理员账号';
  }
  return '';
}

function askDelete(user: UserInfo) {
  if (deleteBlockReason(user)) return;
  deleteTarget.value = user;
}

async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    await deleteUser(target.id);
    message.success(`账号 ${target.username} 已删除`);
    deleteTarget.value = null;
    await load();
  } catch (e) {
    message.error(getErrorMessage(e, '删除账号失败'));
  } finally {
    deleting.value = false;
  }
}

// ===================== 密码 =====================

type PasswordMode = 'self' | 'other';
const passwordMode = ref<PasswordMode>('self');
const passwordTarget = ref<UserInfo | null>(null);
const passwordShow = ref(false);
const passwordBusy = ref(false);
const passwordError = ref('');
const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirm: '',
});

const passwordTitle = computed(() =>
  passwordMode.value === 'self'
    ? '修改我的密码'
    : `重置「${passwordTarget.value?.username ?? ''}」的密码`,
);

function openChangeSelf() {
  passwordMode.value = 'self';
  passwordTarget.value = null;
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirm = '';
  passwordError.value = '';
  passwordShow.value = true;
}

function openResetOther(user: UserInfo) {
  if (!isAdmin.value) {
    message.warning('仅管理员可以重置他人密码');
    return;
  }
  passwordMode.value = 'other';
  passwordTarget.value = user;
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirm = '';
  passwordError.value = '';
  passwordShow.value = true;
}

async function submitPassword() {
  if (passwordMode.value === 'self' && !passwordForm.oldPassword) {
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
    if (passwordMode.value === 'self') {
      await changeMyPassword(
        passwordForm.oldPassword,
        passwordForm.newPassword,
      );
      message.success('密码已修改');
    } else {
      const target = passwordTarget.value;
      if (!target) return;
      await resetUserPassword(target.id, passwordForm.newPassword);
      message.success(`已重置「${target.username}」的密码`);
    }
    passwordShow.value = false;
  } catch (e) {
    passwordError.value = getErrorMessage(e, '密码操作失败');
  } finally {
    passwordBusy.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4 animate-fade-up">
    <PageHeader
      title="用户管理"
      description="管理登录账号与角色；管理员可重置他人密码，删除由后端校验「不能删自己 / 至少保留一个管理员」"
      :icon="PeopleOutline"
    >
      <template #actions>
        <NButton size="small" quaternary @click="load">
          <template #icon
            ><NIcon><RefreshOutline /></NIcon
          ></template>
          刷新
        </NButton>
        <NButton size="small" type="primary" @click="openCreate">
          <template #icon
            ><NIcon><PersonAddOutline /></NIcon
          ></template>
          创建账号
        </NButton>
      </template>
    </PageHeader>

    <div class="relative flex-1 min-h-0">
      <div class="h-full overflow-y-auto pr-1">
        <ErrorState v-if="error" :message="error" @retry="load" />

        <EmptyState
          v-else-if="!loading && users.length === 0"
          :icon="PeopleOutline"
          title="还没有任何账号"
          description="创建一个登录账号后即可进入文件库、分享与 APP 版本管理等模块。"
        >
          <NButton size="small" type="primary" @click="openCreate">
            <template #icon
              ><NIcon><PersonAddOutline /></NIcon
            ></template>
            创建第一个账号
          </NButton>
        </EmptyState>

        <div v-else class="flex flex-col gap-3">
          <section class="glass-panel px-4 py-2">
            <div
              class="flex items-center gap-2 flex-wrap text-11px text-ink-sub"
            >
              <span>共 {{ users.length }} 个账号</span>
              <span class="opacity-40">·</span>
              <span>当前登录：{{ authStore.user?.username ?? '—' }}</span>
              <span class="ml-auto">管理员 {{ adminCount }} 个</span>
            </div>
            <div class="overflow-x-auto mt-2">
              <table
                class="app-table w-full min-w-720px border-collapse text-12px"
              >
                <thead>
                  <tr class="text-left text-11px text-ink-sub">
                    <th class="py-2 pr-3 font-500">用户</th>
                    <th class="py-2 px-2 font-500 w-24">角色</th>
                    <th class="py-2 px-2 font-500 w-20">ID</th>
                    <th class="py-2 px-2 font-500 w-44">创建时间</th>
                    <th class="py-2 pl-2 font-500 text-right w-64">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="user in pagedUsers"
                    :key="user.id"
                    class="border-t border-glass-border/60 dark:border-glass-border-dark/60 hover:bg-brand-500/5"
                  >
                    <td class="py-2.5 pr-3">
                      <div class="flex items-center gap-2 min-w-0">
                        <span
                          class="glass-chip w-7 h-7 flex items-center justify-center text-12px font-600 text-brand-600 dark:text-brand-400 uppercase shrink-0"
                        >
                          {{ user.username.slice(0, 1) }}
                        </span>
                        <span class="text-ink truncate" :title="user.username">
                          {{ user.username }}
                        </span>
                        <NTag
                          v-if="user.id === currentUserId"
                          size="tiny"
                          :bordered="false"
                          type="success"
                        >
                          当前登录
                        </NTag>
                      </div>
                    </td>
                    <td class="py-2.5 px-2">
                      <NTag
                        size="tiny"
                        :bordered="false"
                        :type="ROLE_META[user.role].type"
                      >
                        {{ ROLE_META[user.role].label }}
                      </NTag>
                    </td>
                    <td class="py-2.5 px-2 text-ink-sub tabular-nums">
                      #{{ user.id }}
                    </td>
                    <td
                      class="py-2.5 px-2 text-ink-sub tabular-nums whitespace-nowrap"
                    >
                      {{ formatDateTime(user.createdAt) }}
                    </td>
                    <td class="py-2.5 pl-2">
                      <div
                        class="flex items-center justify-end gap-1 flex-wrap"
                      >
                        <NButton
                          v-if="user.id === currentUserId"
                          size="tiny"
                          quaternary
                          @click="openChangeSelf"
                        >
                          <template #icon
                            ><NIcon><KeyOutline /></NIcon
                          ></template>
                          修改我的密码
                        </NButton>
                        <NButton
                          v-else-if="isAdmin"
                          size="tiny"
                          quaternary
                          @click="openResetOther(user)"
                        >
                          <template #icon
                            ><NIcon><KeyOutline /></NIcon
                          ></template>
                          重置密码
                        </NButton>
                        <NTooltip v-else trigger="hover">
                          <template #trigger>
                            <span>
                              <NButton size="tiny" quaternary disabled>
                                <template #icon
                                  ><NIcon><LockClosedOutline /></NIcon
                                ></template>
                                重置密码
                              </NButton>
                            </span>
                          </template>
                          仅管理员可以重置他人密码
                        </NTooltip>

                        <NTooltip
                          v-if="deleteBlockReason(user)"
                          trigger="hover"
                        >
                          <template #trigger>
                            <span>
                              <NButton size="tiny" quaternary disabled>
                                <template #icon
                                  ><NIcon><TrashOutline /></NIcon
                                ></template>
                                删除
                              </NButton>
                            </span>
                          </template>
                          {{ deleteBlockReason(user) }}
                        </NTooltip>
                        <NButton
                          v-else
                          size="tiny"
                          quaternary
                          type="error"
                          @click="askDelete(user)"
                        >
                          <template #icon
                            ><NIcon><TrashOutline /></NIcon
                          ></template>
                          删除
                        </NButton>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <footer
            v-if="users.length > pageSize"
            class="glass-panel sticky bottom-0 z-10 px-4 py-2 flex items-center justify-end"
          >
            <NPagination
              :page-slot="5"
              v-model:page="page"
              v-model:page-size="pageSize"
              :item-count="users.length"
              :page-sizes="[10, 20, 50]"
              show-size-picker
            />
          </footer>

          <p class="m-0 text-10px text-ink-sub">
            说明：删除规则由后端权威校验（不能删除当前登录账号、至少保留一个管理员），
            页面上的禁用提示只是提前告知。
          </p>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>

    <!-- 创建账号 -->
    <NModal
      v-model:show="createShow"
      preset="card"
      title="创建账号"
      class="max-w-440px"
      :mask-closable="!creating"
      :closable="!creating"
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
          <NButton quaternary :disabled="creating" @click="createShow = false">
            取消
          </NButton>
          <NButton type="primary" :loading="creating" @click="submitCreate">
            创建
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 修改自己的密码 -->
    <NModal
      v-model:show="passwordShow"
      preset="card"
      :title="passwordTitle"
      class="max-w-440px"
      :mask-closable="!passwordBusy"
      :closable="!passwordBusy"
    >
      <div class="flex flex-col gap-3">
        <div v-if="passwordMode === 'self'" class="flex flex-col gap-1">
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
            @click="passwordShow = false"
          >
            取消
          </NButton>
          <NButton
            type="primary"
            :loading="passwordBusy"
            @click="submitPassword"
          >
            保存
          </NButton>
        </div>
      </template>
    </NModal>

    <ConfirmModal
      :show="deleteTarget !== null"
      title="删除账号"
      :content="`确认删除账号「${deleteTarget?.username ?? ''}」？\n该操作不可恢复，删除后该账号将无法登录。`"
      positive-text="确认删除"
      :loading="deleting"
      @update:show="
        (value) => {
          if (!value) deleteTarget = null;
        }
      "
      @confirm="confirmDelete"
    />
  </div>
</template>
