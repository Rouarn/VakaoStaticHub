<script setup lang="ts">
import { computed, h, ref } from 'vue';
import type { Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NTooltip,
  NIcon,
  NDropdown,
  NAvatar,
  NModal,
  NInput,
  NButton,
  useMessage,
} from 'naive-ui';
import {
  MoonOutline,
  SunnyOutline,
  KeyOutline,
  LogOutOutline,
  CloudOutline,
  ChevronForwardOutline,
  ChevronBackOutline,
} from '@vicons/ionicons5';
import { routes } from '@/router/routes';
import { useAppStore } from '@/stores/modules/app';
import { useAuthStore } from '@/stores/modules/auth';
import { changeMyPassword } from '@/api/users';
import { getErrorMessage } from '@/utils/http';

const message = useMessage();
const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();

const expanded = computed(() => appStore.sidebarExpanded);

interface NavItem {
  name: string;
  title: string;
  icon?: Component;
  children?: { name: string; title: string }[];
}

/** 从路由表提取侧边栏项（单一来源，避免菜单与路由漂移） */
const navItems = computed<NavItem[]>(() => {
  const root = routes.find((r) => r.path === '/');
  const children = root?.children ?? [];
  return children
    .filter((r) => r.meta?.sidebar)
    .map((r) => ({
      name: String(r.name),
      title: String(r.meta?.title ?? r.name),
      icon: r.meta?.icon,
      children: r.children
        ?.filter((c) => c.meta?.title)
        .map((c) => ({
          name: String(c.name),
          title: String(c.meta?.title ?? c.name),
        })),
    }));
});

/** tools 等带子路由的入口按路径前缀判定激活 */
const activeName = computed(() => {
  const matched = navItems.value.find(
    (item) =>
      route.name === item.name ||
      (item.name === 'tools' && route.path.startsWith('/tools')),
  );
  return matched?.name ?? '';
});

function go(name: string) {
  void router.push({ name });
}

const userOptions = [
  { label: '修改密码', key: 'change-password', icon: () => h(KeyOutline) },
  { label: '退出登录', key: 'logout', icon: () => h(LogOutOutline) },
];

// —— 修改密码弹窗 ——
const passwordShow = ref(false);
const passwordBusy = ref(false);
const passwordError = ref('');
const passwordForm = { oldPassword: '', newPassword: '', confirm: '' };

function openChangePassword() {
  passwordForm.oldPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirm = '';
  passwordError.value = '';
  passwordShow.value = true;
}

async function submitPassword() {
  if (!passwordForm.oldPassword) {
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
    await changeMyPassword(passwordForm.oldPassword, passwordForm.newPassword);
    message.success('密码已修改');
    passwordShow.value = false;
  } catch (e) {
    passwordError.value = getErrorMessage(e, '密码修改失败');
  } finally {
    passwordBusy.value = false;
  }
}

function onUserAction(key: string) {
  if (key === 'logout') {
    authStore.clearAuth();
    void router.push({ name: 'login' });
  } else if (key === 'change-password') {
    openChangePassword();
  }
}
</script>

<template>
  <aside
    class="glass-panel h-full flex flex-col items-center py-4 shrink-0 overflow-hidden transition-all duration-300 ease-out box-border"
    :class="expanded ? 'w-52 px-3 gap-2' : 'w-18 px-2 gap-2'"
  >
    <!-- Logo -->
    <div
      class="flex items-center mb-1 shrink-0"
      :class="expanded ? 'w-full gap-2.5 px-1' : 'justify-center'"
    >
      <div
        class="rail-icon-active w-11 h-11 flex items-center justify-center rounded-xl shrink-0"
      >
        <NIcon :size="24"><CloudOutline /></NIcon>
      </div>
      <span
        v-if="expanded"
        class="text-ink text-sm font-600 whitespace-nowrap animate-fade-in"
      >
        静态资源
      </span>
    </div>

    <!-- 系统功能导航 -->
    <nav class="flex flex-col gap-1.5 overflow-y-auto w-full">
      <template v-for="item in navItems" :key="item.name">
        <NTooltip placement="right" :delay="300" :disabled="expanded">
          <template #trigger>
            <button
              class="rail-icon cursor-pointer border-none bg-transparent shrink-0"
              :class="[
                activeName === item.name ? 'rail-icon-active' : '',
                expanded ? 'w-full! justify-start! gap-2.5 px-3' : 'w-11',
              ]"
              @click="go(item.name)"
            >
              <NIcon :size="22" class="shrink-0" :component="item.icon" />
              <span
                v-if="expanded"
                class="text-13px whitespace-nowrap animate-fade-in"
              >
                {{ item.title }}
              </span>
            </button>
          </template>
          {{ item.title }}
        </NTooltip>

        <!-- 子菜单（仅展开态且当前项有子路由时显示） -->
        <div
          v-if="expanded && item.children?.length"
          class="flex flex-col gap-1 pl-9 pr-2"
        >
          <button
            v-for="child in item.children"
            :key="child.name"
            class="cursor-pointer border-none bg-transparent text-left rounded-lg px-2 py-1.5 text-12px whitespace-nowrap transition-colors"
            :class="
              route.name === child.name
                ? 'text-brand-600 dark:text-brand-400 bg-white/60 dark:bg-white/8'
                : 'text-ink-sub hover:text-ink hover:bg-white/40 dark:hover:bg-white/5'
            "
            @click="go(child.name)"
          >
            {{ child.title }}
          </button>
        </div>
      </template>
    </nav>

    <div class="flex-1" />

    <!-- 展开 / 收起 -->
    <NTooltip placement="right" :delay="300" :disabled="expanded">
      <template #trigger>
        <button
          class="rail-icon cursor-pointer border-none bg-transparent shrink-0"
          :class="expanded ? 'w-full! justify-start! gap-2.5 px-3' : 'w-11'"
          @click="appStore.toggleSidebar()"
        >
          <NIcon :size="20" class="shrink-0">
            <ChevronForwardOutline v-if="!expanded" />
            <ChevronBackOutline v-else />
          </NIcon>
          <span
            v-if="expanded"
            class="text-13px whitespace-nowrap animate-fade-in"
          >
            收起菜单
          </span>
        </button>
      </template>
      展开菜单
    </NTooltip>

    <!-- 主题切换 -->
    <NTooltip placement="right" :delay="300" :disabled="expanded">
      <template #trigger>
        <button
          class="rail-icon cursor-pointer border-none bg-transparent shrink-0"
          :class="expanded ? 'w-full! justify-start! gap-2.5 px-3' : 'w-11'"
          @click="appStore.toggleDark()"
        >
          <NIcon :size="22" class="shrink-0">
            <SunnyOutline v-if="appStore.isDark" />
            <MoonOutline v-else />
          </NIcon>
          <span
            v-if="expanded"
            class="text-13px whitespace-nowrap animate-fade-in"
          >
            {{ appStore.isDark ? '切换浅色' : '切换深色' }}
          </span>
        </button>
      </template>
      {{ appStore.isDark ? '切换浅色' : '切换深色' }}
    </NTooltip>

    <!-- 当前用户 -->
    <NDropdown
      trigger="click"
      placement="right-end"
      :options="userOptions"
      @select="onUserAction"
    >
      <div
        class="cursor-pointer flex items-center rounded-xl shrink-0"
        :class="
          expanded
            ? 'w-full gap-2.5 px-2 py-1.5 hover:bg-white/60 dark:hover:bg-white/8'
            : ''
        "
      >
        <NAvatar
          round
          size="medium"
          class="bg-brand-600! text-white align-middle shrink-0"
        >
          {{ authStore.user?.username?.slice(0, 1).toUpperCase() ?? 'U' }}
        </NAvatar>
        <span
          v-if="expanded"
          class="text-13px text-ink-sub whitespace-nowrap truncate animate-fade-in"
        >
          {{ authStore.user?.username ?? '未登录' }}
        </span>
      </div>
    </NDropdown>
  </aside>

  <!-- 修改密码弹窗 -->
  <NModal
    v-model:show="passwordShow"
    preset="card"
    title="修改密码"
    style="width: 420px"
    :mask-closable="false"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-11px text-ink-sub">当前密码</label>
        <NInput
          v-model:value="passwordForm.oldPassword"
          type="password"
          show-password-on="click"
          placeholder="请输入当前密码"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-11px text-ink-sub">新密码（6~64 位）</label>
        <NInput
          v-model:value="passwordForm.newPassword"
          type="password"
          show-password-on="click"
          placeholder="请输入新密码"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-11px text-ink-sub">确认新密码</label>
        <NInput
          v-model:value="passwordForm.confirm"
          type="password"
          show-password-on="click"
          placeholder="再次输入新密码"
          @keyup.enter="passwordBusy || submitPassword()"
        />
      </div>
      <p v-if="passwordError" class="m-0 text-12px text-red-500">
        {{ passwordError }}
      </p>
      <div class="flex justify-end gap-2 pt-1">
        <NButton size="small" quaternary @click="passwordShow = false"
          >取消</NButton
        >
        <NButton
          size="small"
          type="primary"
          :loading="passwordBusy"
          @click="submitPassword"
        >
          确认修改
        </NButton>
      </div>
    </div>
  </NModal>
</template>
