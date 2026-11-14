<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  NButton,
  NIcon,
  NPagination,
  NSelect,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  ArrowUndoOutline,
  BanOutline,
  CloudUploadOutline,
  CopyOutline,
  CreateOutline,
  DocumentTextOutline,
  InformationCircleOutline,
  KeyOutline,
  PlayOutline,
  RocketOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { ListVersionsQuery } from '@vakao/shared';
import {
  APP_VERSION_STATUS,
  STATUS_META,
  deleteApp,
  deleteVersion,
  getApkDownloadUrl,
  listApps,
  listVersions,
  offlineVersion,
} from '@/api/app-update';
import type { AppVersionRecord } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import { formatDateTime, truncateMiddle } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';
import ListLoading from '@/components/common/list-loading.vue';
import RefreshButton from '@/components/common/refresh-button.vue';
import { useListLoading } from '@/composables/use-list-loading';
import AppDetailDrawer from './components/app-detail-drawer.vue';
import AppFormModal from './components/app-form-modal.vue';
import AppUploadModal from './components/app-upload-modal.vue';
import AppPublishModal from './components/app-publish-modal.vue';
import AppForceModal from './components/app-force-modal.vue';
import AppEditModal from './components/app-edit-modal.vue';
import AppRollbackModal from './components/app-rollback-modal.vue';

/**
 * APP 版本管理
 *
 * 服务端能力：
 * - GET /app-updates/versions 支持 platform / appKey / status 过滤 + 分页
 * - GET /app-updates/versions/:id/rollback-candidates 由后端直接返回可回滚版本
 */
const message = useMessage();

const apps = ref<string[]>([]);
const activeApp = ref<string>('');
const statusFilter = ref<number>(-1);
const platformFilter = ref<string>('');
const versions = ref<AppVersionRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
/** 加载态与中文提示：文案规则见 useListLoading（翻页时带页码） */
const {
  loading,
  loadingText,
  refreshing,
  justRefreshed,
  begin: beginLoading,
  refresh,
} = useListLoading({ page });
const error = ref('');

// 版本详情抽屉
const detailShow = ref(false);
const detailTarget = ref<AppVersionRecord | null>(null);

function openDetail(version: AppVersionRecord) {
  detailTarget.value = version;
  detailShow.value = true;
}

const appOptions = computed(() => [
  { label: '全部应用', value: '' },
  ...apps.value.map((key) => ({ label: key, value: key })),
]);

const platformOptions = [
  { label: '全部平台', value: '' },
  { label: 'Android', value: 'android' },
];

const statusOptions = [
  { label: '全部状态', value: -1 },
  { label: '草稿', value: APP_VERSION_STATUS.DRAFT },
  { label: '灰度中', value: APP_VERSION_STATUS.GRAY },
  { label: '全量在线', value: APP_VERSION_STATUS.PUBLISHED },
  { label: '已下架', value: APP_VERSION_STATUS.OFFLINE },
];

async function loadApps() {
  try {
    apps.value = await listApps();
    if (!activeApp.value && apps.value.length > 0) {
      // 默认展示首个应用，避免「全部应用」把多应用版本混在一起
      activeApp.value = apps.value[0];
    }
  } catch (e) {
    message.error(getErrorMessage(e, '应用列表加载失败'));
  }
}

/**
 * silent=true 用于手动刷新：不显示遮罩、失败时保留当前版本卡片，
 * 错误抛给 useListLoading.refresh 统一提示。
 */
async function loadVersions(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true;
  error.value = '';
  const query: ListVersionsQuery = {
    page: page.value,
    pageSize: pageSize.value,
    ...(statusFilter.value >= 0 ? { status: statusFilter.value } : {}),
    ...(platformFilter.value ? { platform: platformFilter.value } : {}),
    ...(activeApp.value ? { appKey: activeApp.value } : {}),
  };
  try {
    const result = await listVersions(query);
    versions.value = result.items;
    total.value = result.total;
  } catch (e) {
    if (options.silent) throw e;
    error.value = getErrorMessage(e, '版本列表加载失败');
    versions.value = [];
    total.value = 0;
  } finally {
    if (!options.silent) loading.value = false;
  }
}

/** 页头「刷新」：不走遮罩，图标旋转 → 对勾 → 箭头 */
function refreshVersions() {
  void refresh(() => loadVersions({ silent: true }), '刷新失败');
}

/** 切换分页 / 筛选前清空版本卡片；total 保留，避免分页条跳动 */
function clearVersions() {
  versions.value = [];
}

/** 进入加载态并清空旧卡片，再请求目标页 */
function reloadVersions() {
  beginLoading(clearVersions);
  void loadVersions();
}

function changeFilter() {
  page.value = 1;
  reloadVersions();
}

function statusMetaOf(version: AppVersionRecord) {
  return STATUS_META[version.status] ?? STATUS_META[0];
}

// ===================== 应用管理 =====================
const appModal = ref<'create' | 'rename' | null>(null);

function openCreateApp() {
  appModal.value = 'create';
}

function openRenameApp() {
  if (!activeApp.value) {
    message.warning('请先选择一个应用');
    return;
  }
  appModal.value = 'rename';
}

async function onAppSaved(value: string) {
  activeApp.value = value;
  await loadApps();
  await loadVersions();
}

const deleteAppShow = ref(false);
const deletingApp = ref(false);
const deleteAppTarget = ref('');

function openDeleteApp() {
  if (!activeApp.value) {
    message.warning('请先选择一个应用');
    return;
  }
  deleteAppTarget.value = activeApp.value;
  deleteAppShow.value = true;
}

async function confirmDeleteApp() {
  deletingApp.value = true;
  try {
    const result = await deleteApp(deleteAppTarget.value);
    message.success(
      `应用 ${deleteAppTarget.value} 已删除（版本 ${result.versionCount} / 事件 ${result.eventCount} / 索引 ${result.fileCount}）`,
    );
    deleteAppShow.value = false;
    activeApp.value = apps.value.find((a) => a !== deleteAppTarget.value) ?? '';
    page.value = 1;
    await loadApps();
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '删除应用失败'));
  } finally {
    deletingApp.value = false;
  }
}

// ===================== APK 上传 =====================
const uploadShow = ref(false);

function openUpload() {
  uploadShow.value = true;
}

async function onUploaded(appKey: string) {
  activeApp.value = appKey;
  await loadVersions();
}

// ===================== 发布 =====================
const publishShow = ref(false);
const publishTarget = ref<AppVersionRecord | null>(null);

function openPublish(version: AppVersionRecord) {
  publishTarget.value = version;
  publishShow.value = true;
}

// ===================== 强更 =====================
const forceShow = ref(false);
const forceTarget = ref<AppVersionRecord | null>(null);

function openForce(version: AppVersionRecord) {
  forceTarget.value = version;
  forceShow.value = true;
}

// ===================== 编辑 =====================
const editShow = ref(false);
const editTarget = ref<AppVersionRecord | null>(null);

function openEdit(version: AppVersionRecord) {
  editTarget.value = version;
  editShow.value = true;
}

// ===================== 下架 / 回滚 / 删除 =====================
const offlineShow = ref(false);
const offlining = ref(false);
const offlineTarget = ref<AppVersionRecord | null>(null);

function openOffline(version: AppVersionRecord) {
  offlineTarget.value = version;
  offlineShow.value = true;
}

async function confirmOffline() {
  const target = offlineTarget.value;
  if (!target) return;
  offlining.value = true;
  try {
    await offlineVersion(target.id);
    message.success(`v${target.versionName} 已手动下架`);
    offlineShow.value = false;
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '下架失败'));
  } finally {
    offlining.value = false;
  }
}

const rollbackShow = ref(false);
const rollbackTarget = ref<AppVersionRecord | null>(null);

function openRollback(version: AppVersionRecord) {
  rollbackTarget.value = version;
  rollbackShow.value = true;
}

const deleteShow = ref(false);
const deleting = ref(false);
const deleteTarget = ref<AppVersionRecord | null>(null);

function openDelete(version: AppVersionRecord) {
  deleteTarget.value = version;
  deleteShow.value = true;
}

async function confirmDelete() {
  const target = deleteTarget.value;
  if (!target) return;
  deleting.value = true;
  try {
    const result = await deleteVersion(target.id);
    message.success(
      `v${target.versionName} 已删除（清理事件 ${result.eventCount} 条）`,
    );
    deleteShow.value = false;
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '删除失败'));
  } finally {
    deleting.value = false;
  }
}

async function copyChecksum(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    message.success('checksum 已复制');
  } catch {
    message.error('复制失败');
  }
}

function canEdit(version: AppVersionRecord) {
  return (
    version.status === APP_VERSION_STATUS.DRAFT ||
    version.status === APP_VERSION_STATUS.OFFLINE
  );
}

function canDelete(version: AppVersionRecord) {
  return canEdit(version);
}

function canRollback(version: AppVersionRecord) {
  return (
    version.status === APP_VERSION_STATUS.GRAY ||
    version.status === APP_VERSION_STATUS.PUBLISHED
  );
}

function offlineReasonLabel(version: AppVersionRecord) {
  if (version.status !== APP_VERSION_STATUS.OFFLINE) return '';
  if (version.offlineReason === 'auto') return '自动下架';
  if (version.offlineReason === 'manual') return '手动下架';
  return '下架原因未知';
}

onMounted(async () => {
  await loadApps();
  await loadVersions();
});
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-3">
    <PageHeader
      title="APP 版本管理"
      description="上传 APK、全量/灰度发布、强更与一键回滚；下架原因区分自动与手动"
      :icon="RocketOutline"
    >
      <template #actions>
        <NButton size="small" @click="openCreateApp">
          <template #icon
            ><NIcon><AddOutline /></NIcon
          ></template>
          新建应用
        </NButton>
        <NButton type="primary" size="small" @click="openUpload">
          <template #icon
            ><NIcon><CloudUploadOutline /></NIcon
          ></template>
          上传 APK
        </NButton>
      </template>
    </PageHeader>

    <!-- 应用栏 -->
    <section class="glass-panel shrink-0 px-4 py-3 flex flex-col gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-12px text-ink-sub shrink-0">应用</span>
        <button
          v-for="key in apps"
          :key="key"
          class="px-2.5 py-1 rounded-full text-12px cursor-pointer border-none transition-colors"
          :class="
            activeApp === key
              ? 'bg-brand-600 text-white'
              : 'bg-white/50 dark:bg-white/8 text-ink-sub hover:text-brand-600 dark:hover:text-brand-400'
          "
          @click="
            activeApp = key;
            changeFilter();
          "
        >
          {{ key }}
        </button>
        <span v-if="apps.length === 0" class="text-12px text-ink-sub">
          暂无应用，请先「新建应用」
        </span>

        <div class="ml-auto flex items-center gap-1">
          <NTooltip :delay="300">
            <template #trigger>
              <NButton
                size="tiny"
                quaternary
                :disabled="!activeApp"
                @click="openRenameApp"
              >
                <template #icon
                  ><NIcon><CreateOutline /></NIcon
                ></template>
                重命名
              </NButton>
            </template>
            修改应用标识（目录与全部版本记录一并迁移）
          </NTooltip>
          <NTooltip :delay="300">
            <template #trigger>
              <NButton
                size="tiny"
                quaternary
                type="error"
                :disabled="!activeApp"
                @click="openDeleteApp"
              >
                <template #icon
                  ><NIcon><TrashOutline /></NIcon
                ></template>
                删除应用
              </NButton>
            </template>
            物理删除应用目录与全部版本、事件记录（不可恢复）
          </NTooltip>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <NSelect
          v-model:value="activeApp"
          size="small"
          :options="appOptions"
          class="w-40"
          @update:value="changeFilter"
        />
        <NSelect
          v-model:value="statusFilter"
          size="small"
          :options="statusOptions"
          class="w-32"
          @update:value="changeFilter"
        />
        <NSelect
          v-model:value="platformFilter"
          size="small"
          :options="platformOptions"
          class="w-32"
          @update:value="changeFilter"
        />
        <RefreshButton
          :loading="refreshing"
          :success="justRefreshed"
          @click="refreshVersions"
        />
        <span class="ml-auto text-11px text-ink-sub">
          共 {{ total }} 个版本 · 后端分页
        </span>
      </div>
    </section>

    <div class="relative flex-1 min-h-0">
      <div class="h-full overflow-y-auto pr-1">
        <ErrorState v-if="error" :message="error" @retry="loadVersions" />

        <EmptyState
          v-else-if="!loading && versions.length === 0"
          :icon="CloudUploadOutline"
          title="还没有版本记录"
          :description="
            apps.length === 0
              ? '先创建一个应用，再上传 APK 生成第一个草稿版本。'
              : '上传 APK 后会生成草稿版本，确认无误再发布全量或灰度。'
          "
        >
          <NButton v-if="apps.length === 0" size="small" @click="openCreateApp"
            >新建应用</NButton
          >
          <NButton v-else size="small" type="primary" @click="openUpload"
            >上传 APK</NButton
          >
        </EmptyState>

        <div v-else class="flex flex-col gap-3">
          <article
            v-for="version in versions"
            :key="version.id"
            class="glass-card px-4 py-3 flex flex-col gap-2.5"
          >
            <div class="flex items-start gap-3 flex-wrap">
              <div class="min-w-0 flex-1">
                <p class="m-0 text-13px font-600 text-ink truncate">
                  {{ version.appKey }} · v{{ version.versionName }}
                  <span class="text-11px text-ink-sub font-normal"
                    >vc {{ version.versionCode }}</span
                  >
                </p>
                <p class="m-0 mt-0.5 text-11px text-ink-sub">
                  {{ formatBytes(version.packageSize) }} ·
                  {{ version.platform }} · 发布
                  {{ formatDateTime(version.publishTime) }}
                </p>
              </div>

              <div class="flex items-center gap-1.5 flex-wrap">
                <NTag
                  size="small"
                  :type="statusMetaOf(version).tag"
                  :bordered="false"
                >
                  {{ statusMetaOf(version).label }}
                </NTag>
                <NTag
                  v-if="offlineReasonLabel(version)"
                  size="small"
                  :bordered="false"
                  :type="version.offlineReason === 'auto' ? 'default' : 'error'"
                >
                  {{ offlineReasonLabel(version) }}
                </NTag>
                <NTag
                  v-if="version.forceUpdate === 1"
                  size="small"
                  :bordered="false"
                  type="error"
                >
                  强制更新
                </NTag>
                <NTag
                  v-if="version.status === APP_VERSION_STATUS.GRAY"
                  size="small"
                  :bordered="false"
                  type="warning"
                >
                  灰度 {{ version.grayPercent }}%
                  <template v-if="version.grayAutoIncrement === 1">
                    · 自动递增</template
                  >
                </NTag>
                <NTag
                  v-if="version.scheduledPublishAt"
                  size="small"
                  :bordered="false"
                >
                  定时 {{ formatDateTime(version.scheduledPublishAt) }}
                </NTag>
              </div>
            </div>

            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 text-11px text-ink-sub"
            >
              <span class="inline-flex items-center gap-1 font-mono">
                SHA-256 {{ truncateMiddle(version.checksum, 12, 10) }}
                <button
                  class="border-none bg-transparent cursor-pointer text-brand-600 dark:text-brand-400"
                  @click="copyChecksum(version.checksum)"
                >
                  <NIcon :size="12"><CopyOutline /></NIcon>
                </button>
              </span>
              <span v-if="version.minVersionCode > 0"
                >minVersionCode {{ version.minVersionCode }}</span
              >
              <span
                v-if="version.updateLog"
                class="min-w-0 truncate"
                :title="version.updateLog"
              >
                更新说明：{{ version.updateLog }}
              </span>
              <a
                :href="getApkDownloadUrl(version.id)"
                class="text-brand-600 dark:text-brand-400 inline-flex items-center gap-1"
                target="_blank"
                rel="noreferrer"
              >
                <NIcon :size="12"><DocumentTextOutline /></NIcon>
                下载 APK
              </a>
            </div>

            <div class="flex items-center gap-1.5 flex-wrap">
              <NButton
                v-if="version.status !== APP_VERSION_STATUS.PUBLISHED"
                size="tiny"
                type="primary"
                @click="openPublish(version)"
              >
                <template #icon
                  ><NIcon><PlayOutline /></NIcon
                ></template>
                {{
                  version.status === APP_VERSION_STATUS.OFFLINE
                    ? '重新发布'
                    : '发布'
                }}
              </NButton>
              <NButton
                v-if="canEdit(version)"
                size="tiny"
                @click="openEdit(version)"
              >
                <template #icon
                  ><NIcon><CreateOutline /></NIcon
                ></template>
                编辑
              </NButton>
              <NButton size="tiny" quaternary @click="openDetail(version)">
                <template #icon
                  ><NIcon><InformationCircleOutline /></NIcon
                ></template>
                详情
              </NButton>
              <NButton size="tiny" @click="openForce(version)">
                <template #icon
                  ><NIcon><KeyOutline /></NIcon
                ></template>
                强更配置
              </NButton>
              <NButton
                v-if="canRollback(version)"
                size="tiny"
                @click="openRollback(version)"
              >
                <template #icon
                  ><NIcon><ArrowUndoOutline /></NIcon
                ></template>
                回滚
              </NButton>
              <NButton
                v-if="canRollback(version)"
                size="tiny"
                quaternary
                type="error"
                @click="openOffline(version)"
              >
                <template #icon
                  ><NIcon><BanOutline /></NIcon
                ></template>
                下架
              </NButton>
              <NButton
                v-if="canDelete(version)"
                size="tiny"
                quaternary
                type="error"
                class="ml-auto"
                @click="openDelete(version)"
              >
                <template #icon
                  ><NIcon><TrashOutline /></NIcon
                ></template>
                删除
              </NButton>
            </div>
          </article>

          <footer
            class="glass-panel sticky bottom-0 z-10 px-4 py-2 flex items-center justify-end"
          >
            <NPagination
              :page-slot="5"
              v-model:page="page"
              v-model:page-size="pageSize"
              :item-count="total"
              :page-sizes="[10, 20, 50]"
              show-size-picker
              @update:page="reloadVersions"
              @update:page-size="changeFilter"
            />
          </footer>
        </div>
      </div>
      <ListLoading :show="loading" :text="loadingText" />
    </div>

    <AppDetailDrawer v-model:show="detailShow" :version="detailTarget" />

    <AppFormModal
      :show="appModal !== null"
      :mode="appModal"
      :active-app="activeApp"
      @update:show="
        (value) => {
          if (!value) appModal = null;
        }
      "
      @saved="onAppSaved"
    />

    <AppUploadModal
      v-model:show="uploadShow"
      :apps="apps"
      :active-app="activeApp"
      @uploaded="onUploaded"
    />

    <AppPublishModal
      v-model:show="publishShow"
      :version="publishTarget"
      @done="loadVersions"
    />

    <AppForceModal
      v-model:show="forceShow"
      :version="forceTarget"
      @done="loadVersions"
    />

    <AppEditModal
      v-model:show="editShow"
      :version="editTarget"
      @done="loadVersions"
    />

    <!-- 下架 -->
    <ConfirmModal
      v-model:show="offlineShow"
      title="手动下架版本"
      :content="`下架后该版本对客户端立即不可见（检查与下载均返回不存在），APK 文件保留。\n该版本会被标记为「手动下架」（offlineReason=manual），回滚不会自动恢复它。\n目标：${offlineTarget?.appKey ?? ''} v${offlineTarget?.versionName ?? ''}（vc ${offlineTarget?.versionCode ?? ''}）`"
      positive-text="确认下架"
      :loading="offlining"
      @confirm="confirmOffline"
    />

    <AppRollbackModal
      v-model:show="rollbackShow"
      :version="rollbackTarget"
      @done="loadVersions"
    />

    <ConfirmModal
      v-model:show="deleteShow"
      title="删除版本"
      :content="`将物理删除版本记录、该版本（vc ${deleteTarget?.versionCode ?? ''}）的升级漏斗事件、文件索引与磁盘 APK，不可恢复。\n目标：${deleteTarget?.appKey ?? ''} v${deleteTarget?.versionName ?? ''}`"
      positive-text="确认删除"
      :loading="deleting"
      @confirm="confirmDelete"
    />

    <ConfirmModal
      v-model:show="deleteAppShow"
      title="删除应用"
      :content="`将物理删除应用 ${deleteAppTarget} 的整个目录、全部版本记录、升级事件与文件索引，不可恢复。`"
      positive-text="确认删除应用"
      :loading="deletingApp"
      @confirm="confirmDeleteApp"
    />
  </div>
</template>
