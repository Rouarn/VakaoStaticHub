<script setup lang="ts">
import { onMounted, ref, h } from 'vue';
import {
  NCard,
  NDataTable,
  NButton,
  NTag,
  NModal,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import type { UserInfo } from '@vakao/shared';
import { listUsers, deleteUser } from '@/api/auth';
import { getErrorMessage } from '@/utils/request';
import { useAuthStore } from '@/stores/modules/auth';
import RegisterForm from './register.vue';

const authStore = useAuthStore();
const message = useMessage();

const users = ref<UserInfo[]>([]);
const loading = ref(false);
const showDeleteModal = ref(false);
const deleteTarget = ref<UserInfo | null>(null);
const deleting = ref(false);
const showCreateModal = ref(false);

function formatTime(ts?: number) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

async function loadUsers() {
  loading.value = true;
  try {
    users.value = await listUsers();
  } catch (error) {
    message.error(getErrorMessage(error, '加载用户列表失败'));
  } finally {
    loading.value = false;
  }
}

function openDeleteModal(user: UserInfo) {
  deleteTarget.value = user;
  showDeleteModal.value = true;
}

async function handleCreateSuccess(username: string) {
  showCreateModal.value = false;
  message.success(`用户 ${username} 创建成功`);
  await loadUsers();
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await deleteUser(deleteTarget.value.id);
    message.success(`用户 ${deleteTarget.value.username} 已删除`);
    showDeleteModal.value = false;
    await loadUsers();
  } catch (error) {
    message.error(getErrorMessage(error, '删除失败'));
  } finally {
    deleting.value = false;
  }
}

const columns: DataTableColumns<UserInfo> = [
  { title: 'ID', key: 'id', width: 80 },
  { title: '用户名', key: 'username' },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 200,
    render: (row) => formatTime(row.createdAt),
  },
  {
    title: '操作',
    key: 'actions',
    width: 140,
    render: (row) => {
      const isSelf = row.id === authStore.userInfo?.id;
      return h('div', { class: 'flex items-center gap-2' }, [
        isSelf
          ? h(NTag, { size: 'small' }, { default: () => '当前用户' })
          : null,
        h(
          NButton,
          {
            size: 'small',
            type: 'error',
            tertiary: true,
            disabled: isSelf,
            onClick: () => openDeleteModal(row),
          },
          { default: () => '删除' },
        ),
      ]);
    },
  },
];

onMounted(loadUsers);
</script>

<template>
  <div class="p-4 sm:p-6">
    <NCard title="用户管理" class="shadow-xl rounded-2xl border-none bg-base">
      <template #header-extra>
        <div class="flex items-center gap-2">
          <NButton size="small" type="primary" @click="showCreateModal = true">
            创建用户
          </NButton>
          <NButton size="small" :loading="loading" @click="loadUsers">
            刷新
          </NButton>
        </div>
      </template>
      <p class="text-sm text-gray-500 mb-4">
        所有已登录用户均可创建新账号；此处可查看并删除用户，当前登录用户不可删除。
      </p>
      <NDataTable
        :columns="columns"
        :data="users"
        :loading="loading"
        :row-key="(row: UserInfo) => row.id"
      />
    </NCard>

    <NModal
      v-model:show="showCreateModal"
      preset="card"
      title="创建账号"
      class="max-w-md w-full"
    >
      <RegisterForm @success="handleCreateSuccess" />
    </NModal>

    <NModal
      v-model:show="showDeleteModal"
      preset="dialog"
      title="确认删除用户"
      positive-text="删除"
      negative-text="取消"
      :loading="deleting"
      @positive-click="confirmDelete"
    >
      确定要删除用户 <b>{{ deleteTarget?.username }}</b> 吗？此操作不可恢复。
    </NModal>
  </div>
</template>
