<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import type { Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
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
  EyeOutline,
  OpenOutline,
} from '@vicons/ionicons5';
import { routes } from '@/router/routes';
import { useAppStore } from '@/stores/modules/app';
import { useAuthStore } from '@/stores/modules/auth';
import { useOverviewStore } from '@/stores/modules/overview';
import { changeMyPassword } from '@/api/users';
import { getErrorMessage } from '@/utils/http';
import { colors } from '@/config/design-tokens';

/**
 * 左侧导航（对齐原型的单栏侧边栏）
 *
 * - 品牌区 + 分组导航（资源 / 发布 / 系统 / 工具）+ 底部账号与主题切换
 * - 菜单区可滚动但不显示滚动条（scrollbar-hidden），主体区域保持默认滚动条
 * - 导航项仍从路由表派生，避免菜单与路由漂移
 */
const message = useMessage();
const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const authStore = useAuthStore();
const overview = useOverviewStore();

interface SideItem {
  name: string;
  title: string;
  icon?: Component;
  group?: string;
}

/** 路由表 → 扁平侧栏项（带子路由的入口展开为子项） */
const navEntries = computed<SideItem[]>(() => {
  const root = routes.find((r) => r.path === '/');
  const out: SideItem[] = [];
  for (const r of root?.children ?? []) {
    if (!r.meta?.sidebar) continue;
    if (r.children?.length) {
      for (const c of r.children) {
        if (c.meta?.title) {
          out.push({
            name: String(c.name),
            title: String(c.meta.title),
            icon: c.meta.icon,
            group: c.meta.group ?? r.meta?.group,
          });
        }
      }
    } else {
      out.push({
        name: String(r.name),
        title: String(r.meta?.title ?? r.name),
        icon: r.meta?.icon,
        group: r.meta?.group,
      });
    }
  }
  out.push(...STATIC_TOOLS);
  return out;
});

/** 静态工具项：不在路由表里，直接给预览页提供入口 */
const STATIC_TOOLS: SideItem[] = [
  {
    name: 'local-file-preview',
    title: '本地预览',
    icon: EyeOutline,
    group: '工具',
  },
  {
    name: 'external-preview',
    title: '外部预览',
    icon: OpenOutline,
    group: '工具',
  },
];

/** 分组顺序（分组信息来自路由 meta.group，避免菜单与路由漂移） */
const GROUP_ORDER = ['资源', '发布', '系统', '工具'];

const groups = computed(() => {
  const map = new Map<string, SideItem[]>();
  for (const item of navEntries.value) {
    const key = item.group ?? '其他';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return GROUP_ORDER.map((label) => ({
    label,
    items: map.get(label) ?? [],
  })).filter((group) => group.items.length > 0);
});

/** 侧栏徽标：文件 / 分享总数来自轻量聚合接口 */
function badgeFor(name: string): number | undefined {
  if (name === 'files') return overview.files;
  if (name === 'shares') return overview.shares;
  return undefined;
}

onMounted(() => {
  void overview.load();
});
watch(
  () => route.name,
  () => {
    void overview.load();
  },
);

const isActive = (name: string) => route.name === name;

function go(name: string) {
  if (name === 'external-preview') {
    window.open(`${window.location.origin}/file-preview`, '_blank', 'noopener');
    return;
  }
  void router.push({ name });
}

/** 危险操作文字：浅色用 700、深色用 300，保证在常态与 hover 底上均 ≥4.5:1 */
const dangerTextClass = computed(() =>
  appStore.isDark ? 'text-red-300' : 'text-red-700',
);

/** 账号浮层局部主题：只作用于本 NDropdown，不改全局 Dropdown */
const dropdownThemeOverrides = computed(() => ({
  padding: '4px',
  optionHeightSmall: '34px',
  fontSizeSmall: '12px',
  optionIconSizeSmall: '16px',
  optionIconPrefixWidthSmall: '28px',
  optionPrefixWidthSmall: '10px',
  optionColorHover: appStore.isDark
    ? 'rgba(255,255,255,0.08)'
    : colors.brand[50],
  dividerColor: appStore.isDark
    ? colors.glass.borderDark
    : `${colors.ink.secondary}26`,
  peers: {
    Popover: {
      boxShadow: appStore.isDark
        ? `0 8px 32px ${colors.shadow.glassDark}`
        : `0 8px 32px ${colors.shadow.glassLight}`,
    },
  },
}));

/** 浮层本体：定宽 + 与玻璃面板一致的 1px 边框（Naive 下拉默认无边框） */
function dropdownMenuProps() {
  return {
    style: `width: 168px; min-width: 168px; border: 1px solid ${
      appStore.isDark ? colors.glass.borderDark : colors.glass.borderLight
    };`,
  };
}

const userOptions = [
  {
    label: '修改密码',
    key: 'change-password',
    icon: () => h(NIcon, { size: 16 }, { default: () => h(KeyOutline) }),
  },
  { type: 'divider', key: 'divider' },
  {
    label: () => h('span', { class: dangerTextClass.value }, '退出登录'),
    key: 'logout',
    icon: () =>
      h(
        NIcon,
        { size: 16, class: dangerTextClass.value },
        { default: () => h(LogOutOutline) },
      ),
  },
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
    class="glass-panel h-full w-60 shrink-0 flex flex-col overflow-hidden box-border"
  >
    <!-- 品牌区 -->
    <div class="flex items-center gap-2.5 px-4 pt-4 pb-3 shrink-0">
      <img
        src="/brand/star-four.svg"
        alt="VaKao"
        class="w-7 h-7 shrink-0 dark:hidden"
      />
      <img
        src="/brand/star-white.svg"
        alt="VaKao"
        class="w-7 h-7 shrink-0 hidden dark:block"
      />
      <div class="min-w-0">
        <p class="m-0 text-13px font-600 text-ink leading-tight truncate">
          Vakao Static Hub
        </p>
        <p class="m-0 text-10.5px text-ink-sub leading-tight">静态资源管理</p>
      </div>
    </div>

    <!-- 分组导航（可滚动，不显示滚动条） -->
    <nav
      class="flex-1 min-h-0 overflow-y-auto scrollbar-hidden px-2 pb-4"
      :class="{ 'nav-fade': route.meta.categoryPanel }"
    >
      <div v-for="group in groups" :key="group.label" class="mb-2">
        <div
          class="px-2 pt-2 pb-1 text-10.5px font-600 tracking-wide text-ink-sub/85"
        >
          {{ group.label }}
        </div>
        <button
          v-for="item in group.items"
          :key="item.name"
          type="button"
          class="w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[10px] border border-solid border-transparent cursor-pointer text-left transition-colors"
          :class="
            isActive(item.name)
              ? 'bg-brand-500/12 dark:bg-brand-400/15 text-brand-700 dark:text-brand-300 font-600'
              : 'bg-transparent text-ink-sub hover:text-ink hover:bg-[var(--mat-hover)]'
          "
          @click="go(item.name)"
        >
          <NIcon
            v-if="item.icon"
            :size="16"
            class="shrink-0"
            :class="
              isActive(item.name)
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-ink-sub'
            "
            :component="item.icon"
          />
          <span class="text-12.5px whitespace-nowrap truncate">
            {{ item.title }}
          </span>
          <span
            v-if="badgeFor(item.name) !== undefined"
            class="ml-auto text-10.5px leading-4 px-1.5 rounded-[5px]"
            :class="
              isActive(item.name)
                ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300'
                : 'bg-[var(--mat-chip)] text-ink-sub'
            "
          >
            {{ badgeFor(item.name) }}
          </span>
        </button>
      </div>
    </nav>

    <!-- 账号 + 主题 -->
    <div class="shrink-0 p-2 border-t border-[var(--mat-line-soft)]">
      <div class="flex items-center gap-1">
        <NDropdown
          trigger="click"
          size="small"
          placement="right-end"
          :options="userOptions"
          :theme-overrides="dropdownThemeOverrides"
          :menu-props="dropdownMenuProps"
          @select="onUserAction"
        >
          <div
            class="flex-1 min-w-0 flex items-center gap-2.5 p-1.5 rounded-[10px] cursor-pointer transition-colors hover:bg-[var(--mat-hover)]"
          >
            <NAvatar
              round
              size="small"
              class="bg-gradient-to-br from-brand-500 to-brand-700! text-white align-middle shrink-0"
            >
              {{ authStore.user?.username?.slice(0, 1).toUpperCase() ?? 'U' }}
            </NAvatar>
            <div class="min-w-0">
              <p
                class="m-0 text-12.5px font-600 text-ink leading-tight truncate"
              >
                {{ authStore.user?.username ?? '未登录' }}
              </p>
              <p class="m-0 text-10.5px text-ink-sub leading-tight">管理员</p>
            </div>
          </div>
        </NDropdown>

        <button
          type="button"
          class="w-7 h-7 grid place-items-center rounded-full border-none bg-transparent text-ink-sub cursor-pointer transition-colors hover:text-ink hover:bg-[var(--mat-hover)]"
          :title="appStore.isDark ? '切换浅色' : '切换深色'"
          @click="appStore.toggleDark()"
        >
          <NIcon :size="15">
            <SunnyOutline v-if="appStore.isDark" />
            <MoonOutline v-else />
          </NIcon>
        </button>
      </div>
    </div>
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
