<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  useMessage,
  NDataTable,
  NButton,
  NIcon,
  NPopconfirm,
  NSpace,
  NTag,
  NInput,
  NModal,
  NSpin,
  NTooltip,
} from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { h } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import {
  LinkOutline,
  CopyOutline,
  TrashOutline,
  RefreshOutline,
  TimeOutline,
  DocumentTextOutline,
  QrCodeOutline,
  DownloadOutline,
} from '@vicons/ionicons5';
import {
  getShareLinks,
  revokeShareLink,
  getShareLinkUrl,
  getShareAccessLogs,
} from '@/api/share';
import QrCode from '@/components/qr-code.vue';
import type { ShareLink, ShareAccessLog } from '@vakao/shared';

defineOptions({
  name: 'share-links',
});

const message = useMessage();
const loading = ref(false);
const shareLinks = ref<ShareLink[]>([]);
const searchText = ref('');

/** 窄屏（手机）：操作列不固定、按钮图标化，避免固定操作列占满视口 */
const isMobile = useMediaQuery('(max-width: 767px)');
/** 表格最小滚动宽度：窄屏操作列 160 + 文件列 180，宽屏操作列 460 + 文件列 200 */
const tableScrollX = computed(() => (isMobile.value ? 1080 : 1400));

const filteredLinks = computed(() => {
  if (!searchText.value) return shareLinks.value;
  const q = searchText.value.toLowerCase();
  return shareLinks.value.filter(
    (link) =>
      link.filePath.toLowerCase().includes(q) ||
      link.category.toLowerCase().includes(q) ||
      link.token.toLowerCase().includes(q) ||
      (link.filePaths ?? []).some((p) => p.toLowerCase().includes(q)),
  );
});

async function loadShareLinks() {
  loading.value = true;
  try {
    const data = await getShareLinks();
    shareLinks.value = data || [];
  } catch {
    message.error('加载分享链接失败');
  } finally {
    loading.value = false;
  }
}

function copyLink(token: string) {
  const url = getShareLinkUrl(token);
  navigator.clipboard.writeText(url).then(
    () => message.success('链接已复制到剪贴板'),
    () => message.error('复制失败'),
  );
}

async function handleRevoke(token: string) {
  try {
    await revokeShareLink(token);
    message.success('已撤销');
    await loadShareLinks();
  } catch {
    message.error('撤销失败');
  }
}

// 访问记录弹窗状态
const logsModalVisible = ref(false);
const logsLoading = ref(false);
const accessLogs = ref<ShareAccessLog[]>([]);
const currentLogLink = ref<ShareLink | null>(null);

/** 打开访问记录弹窗并加载该分享的访问记录 */
async function openAccessLogs(link: ShareLink) {
  currentLogLink.value = link;
  logsModalVisible.value = true;
  logsLoading.value = true;
  accessLogs.value = [];
  try {
    accessLogs.value = (await getShareAccessLogs(link.token)) || [];
  } catch {
    message.error('加载访问记录失败');
  } finally {
    logsLoading.value = false;
  }
}

function closeAccessLogs() {
  logsModalVisible.value = false;
  currentLogLink.value = null;
}

// 二维码弹窗状态
const qrModalVisible = ref(false);
const currentQrLink = ref<ShareLink | null>(null);
const qrCodeRef = ref<{ save: () => void } | null>(null);

function openQrCode(link: ShareLink) {
  currentQrLink.value = link;
  qrModalVisible.value = true;
}

function closeQrCode() {
  qrModalVisible.value = false;
  currentQrLink.value = null;
}

function saveQrCode() {
  qrCodeRef.value?.save();
}

/** 复制当前二维码对应的分享链接 */
function copyCurrentQrLink() {
  if (!currentQrLink.value) return;
  copyLink(currentQrLink.value.token);
}

/** 二维码保存文件名，避免 token 中的特殊字符 */
const qrSaveName = computed(() =>
  currentQrLink.value
    ? `vakao-share-${currentQrLink.value.token.slice(0, 8)}`
    : 'vakao-share',
);

/** 当前二维码对应的分享链接 URL */
const currentQrUrl = computed(() =>
  currentQrLink.value ? getShareLinkUrl(currentQrLink.value.token) : '',
);

function formatAccessTime(ts: number) {
  return new Date(ts).toLocaleString();
}

function formatTime(ts: number | null) {
  if (!ts) return '永不过期';
  const date = new Date(ts);
  const now = new Date();
  if (date < now) return '已过期';
  return date.toLocaleString();
}

function formatExpireStatus(
  ts: number | null,
  maxAccesses: number | null,
  accessCount: number,
) {
  if (ts && ts < Date.now()) return { text: '已过期', type: 'error' as const };
  if (maxAccesses && accessCount >= maxAccesses)
    return { text: '已达上限', type: 'warning' as const };
  return { text: '有效', type: 'success' as const };
}

const columns = computed<DataTableColumns<ShareLink>>(() => [
  {
    title: '类型',
    key: 'shareType',
    width: 90,
    render(row) {
      return h(
        NTag,
        {
          type: row.shareType === 'collection' ? 'info' : 'default',
          size: 'small',
          round: true,
        },
        () => (row.shareType === 'collection' ? '多文件' : '单文件'),
      );
    },
  },
  {
    title: '密码',
    key: 'hasPassword',
    width: 70,
    render(row) {
      return row.hasPassword
        ? h(NTag, { type: 'warning', size: 'small', round: true }, () => '有')
        : h('span', { class: 'text-xs text-gray-400' }, '无');
    },
  },
  {
    title: '文件',
    key: 'filePath',
    ellipsis: { tooltip: true },
    render(row) {
      const displayPath =
        row.shareType === 'collection' && row.filePaths?.length
          ? `${row.filePaths[0]} 等 ${row.filePaths.length} 个文件`
          : row.filePath;
      return h('div', { class: 'flex flex-col' }, [
        h(
          'span',
          { class: 'text-sm font-medium truncate max-w-[400px]' },
          displayPath,
        ),
        h('span', { class: 'text-xs text-gray-400' }, row.category),
      ]);
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render(row) {
      const status = formatExpireStatus(
        row.expiresAt,
        row.maxAccesses,
        row.accessCount,
      );
      return h(
        NTag,
        { type: status.type, size: 'small', round: true },
        () => status.text,
      );
    },
  },
  {
    title: '过期时间',
    key: 'expiresAt',
    width: 180,
    render(row) {
      return h(
        'div',
        { class: 'flex items-center gap-1 text-sm text-gray-500' },
        [
          h(NIcon, { size: 14 }, () => h(TimeOutline)),
          formatTime(row.expiresAt),
        ],
      );
    },
  },
  {
    title: '打开次数',
    key: 'accessCount',
    width: 120,
    render(row) {
      const limit = row.maxAccesses
        ? `${row.accessCount} / ${row.maxAccesses}`
        : `${row.accessCount} / ∞`;
      return h('span', { class: 'text-sm' }, limit);
    },
  },
  {
    title: '创建时间',
    key: 'createdAt',
    width: 180,
    render(row) {
      return new Date(row.createdAt).toLocaleString();
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: isMobile.value ? 160 : 380,
    fixed: isMobile.value ? undefined : 'right',
    render(row) {
      // 窄屏：仅显示图标按钮（悬浮显示名称），不固定在右侧
      if (isMobile.value) {
        return h('div', { class: 'flex items-center gap-1' }, [
          h(NTooltip, null, {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  type: 'primary',
                  onClick: () => copyLink(row.token),
                },
                {
                  icon: () => h(NIcon, null, () => h(CopyOutline)),
                },
              ),
            default: () => '复制链接',
          }),
          h(NTooltip, null, {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  type: 'success',
                  onClick: () => openQrCode(row),
                },
                {
                  icon: () => h(NIcon, null, () => h(QrCodeOutline)),
                },
              ),
            default: () => '二维码',
          }),
          h(NTooltip, null, {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'small',
                  quaternary: true,
                  circle: true,
                  type: 'info',
                  onClick: () => openAccessLogs(row),
                },
                {
                  icon: () => h(NIcon, null, () => h(DocumentTextOutline)),
                },
              ),
            default: () => '访问记录',
          }),
          h(
            NPopconfirm,
            {
              'positive-text': '撤销',
              'negative-text': '取消',
              onPositiveClick: () => handleRevoke(row.token),
            },
            {
              trigger: () =>
                h(
                  NButton,
                  {
                    size: 'small',
                    quaternary: true,
                    circle: true,
                    type: 'error',
                  },
                  {
                    icon: () => h(NIcon, null, () => h(TrashOutline)),
                  },
                ),
              default: () => '确定要撤销此分享链接吗？',
            },
          ),
        ]);
      }
      return h(NSpace, { size: 'small', wrap: false }, () => [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'primary',
            onClick: () => copyLink(row.token),
          },
          {
            icon: () => h(NIcon, null, () => h(CopyOutline)),
            default: () => '复制',
          },
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'success',
            onClick: () => openQrCode(row),
          },
          {
            icon: () => h(NIcon, null, () => h(QrCodeOutline)),
            default: () => '二维码',
          },
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'info',
            onClick: () => openAccessLogs(row),
          },
          {
            icon: () => h(NIcon, null, () => h(DocumentTextOutline)),
            default: () => '访问记录',
          },
        ),
        h(
          NPopconfirm,
          {
            'positive-text': '撤销',
            'negative-text': '取消',
            onPositiveClick: () => handleRevoke(row.token),
          },
          {
            trigger: () =>
              h(
                NButton,
                { size: 'small', quaternary: true, type: 'error' },
                {
                  icon: () => h(NIcon, null, () => h(TrashOutline)),
                  default: () => '撤销',
                },
              ),
            default: () => '确定要撤销此分享链接吗？',
          },
        ),
      ]);
    },
  },
]);

// 访问记录弹窗的表格列定义
const logColumns: DataTableColumns<ShareAccessLog> = [
  {
    title: '访问时间',
    key: 'accessedAt',
    width: 180,
    render(row) {
      return formatAccessTime(row.accessedAt);
    },
  },
  {
    title: 'IP',
    key: 'ip',
    width: 140,
    render(row) {
      return row.ip || '-';
    },
  },
  {
    title: 'User-Agent',
    key: 'userAgent',
    ellipsis: { tooltip: true },
    render(row) {
      return row.userAgent || '-';
    },
  },
];

onMounted(() => {
  loadShareLinks();
});
</script>

<template>
  <main class="px-4 md:px-6 pb-4">
    <div
      class="flex flex-col md:flex-row items-start md:items-center justify-between py-4 mb-4 sticky top-0 z-2 bg-container/95 backdrop-blur supports-[backdrop-filter]:bg-container/80 border-b border-base shadow-sm -mx-4 md:-mx-6 px-4 md:px-6 gap-4 md:gap-0"
    >
      <div>
        <h2
          class="text-xl font-semibold mb-1 text-base flex items-center gap-2"
        >
          <NIcon :component="LinkOutline" />
          分享链接管理
        </h2>
        <span class="text-xs text-gray-500">
          {{ filteredLinks.length }} 个链接
        </span>
      </div>

      <div class="flex items-center gap-2 w-full md:w-auto">
        <NInput
          v-model:value="searchText"
          placeholder="搜索文件或链接..."
          size="small"
          clearable
          class="w-full md:w-50"
        />
        <NButton size="small" @click="loadShareLinks" :loading="loading">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
        </NButton>
      </div>
    </div>

    <div
      v-if="filteredLinks.length === 0 && !loading"
      class="text-center py-16 text-gray-400"
    >
      <NIcon class="text-5xl mb-4 block mx-auto" :component="LinkOutline" />
      <p>暂无分享链接</p>
    </div>

    <NDataTable
      v-else
      :columns="columns"
      :data="filteredLinks"
      :loading="loading"
      :bordered="false"
      :single-line="false"
      :scroll-x="tableScrollX"
      class="rounded-xl shadow-sm"
    />

    <NModal
      :show="logsModalVisible"
      preset="card"
      title="访问记录"
      :mask-closable="true"
      style="max-width: 720px"
      @update:show="
        (value) => {
          if (!value) closeAccessLogs();
        }
      "
    >
      <div v-if="currentLogLink" class="text-xs text-gray-500 mb-3">
        {{ currentLogLink.filePath }}（{{ currentLogLink.token }}）
      </div>
      <NSpin :show="logsLoading">
        <div
          v-if="!logsLoading && accessLogs.length === 0"
          class="text-center py-10 text-gray-400"
        >
          暂无访问记录
        </div>
        <NDataTable
          v-else
          :columns="logColumns"
          :data="accessLogs"
          :bordered="false"
          :single-line="false"
          :scroll-x="560"
          size="small"
          max-height="400"
        />
      </NSpin>
      <template #footer>
        <div class="flex justify-center">
          <NButton @click="closeAccessLogs">关闭</NButton>
        </div>
      </template>
    </NModal>

    <NModal
      :show="qrModalVisible"
      preset="card"
      title="分享二维码"
      :mask-closable="true"
      style="max-width: 420px"
      @update:show="
        (value) => {
          if (!value) closeQrCode();
        }
      "
    >
      <div v-if="currentQrLink" class="flex flex-col items-center gap-3">
        <div class="text-xs text-gray-500 break-all text-center">
          {{ currentQrLink.filePath }}
        </div>
        <QrCode
          ref="qrCodeRef"
          :value="currentQrUrl"
          :size="220"
          label="分享链接二维码"
          :save-name="qrSaveName"
          mode="plain"
          :show-save-button="false"
        />
        <div class="text-xs text-gray-400 break-all text-center max-w-full">
          {{ currentQrUrl }}
        </div>
      </div>
      <template #footer>
        <NSpace justify="end" :wrap="false">
          <NButton @click="closeQrCode">关闭</NButton>
          <NButton type="primary" @click="copyCurrentQrLink">
            <template #icon>
              <NIcon :component="CopyOutline" />
            </template>
            复制链接
          </NButton>
          <NButton type="success" @click="saveQrCode">
            <template #icon>
              <NIcon :component="DownloadOutline" />
            </template>
            保存二维码
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </main>
</template>
