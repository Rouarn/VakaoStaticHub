<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  NButton,
  NDatePicker,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NPagination,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpin,
  NSwitch,
  NTag,
  NTooltip,
  useMessage,
} from 'naive-ui';
import {
  AddOutline,
  ArrowUndoOutline,
  BanOutline,
  CheckmarkCircleOutline,
  CloseCircleOutline,
  CloudUploadOutline,
  CopyOutline,
  CreateOutline,
  DocumentTextOutline,
  InformationCircleOutline,
  KeyOutline,
  PlayOutline,
  RefreshOutline,
  RocketOutline,
  TimeOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  GrayIncrementStep,
  ListVersionsQuery,
  RollbackCandidate,
} from '@vakao/shared';
import {
  APP_VERSION_STATUS,
  STATUS_META,
  createApp,
  createVersion,
  deleteApp,
  deleteVersion,
  getApkDownloadUrl,
  getRollbackCandidates,
  listApps,
  listVersions,
  offlineVersion,
  publishVersion,
  renameApp,
  rollbackVersion,
  setForceUpdate,
  updateVersion,
} from '@/api/app-update';
import type { AppVersionRecord, PublishBody } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import { formatDateTime, truncateMiddle } from '@/utils/format';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import ConfirmModal from '@/components/common/confirm-modal.vue';

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
const loading = ref(false);
const error = ref('');

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

async function loadVersions() {
  loading.value = true;
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
    error.value = getErrorMessage(e, '版本列表加载失败');
    versions.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function changeFilter() {
  page.value = 1;
  void loadVersions();
}

function statusMetaOf(version: AppVersionRecord) {
  return STATUS_META[version.status] ?? STATUS_META[0];
}

// ===================== 应用管理 =====================
const appModal = ref<'create' | 'rename' | null>(null);
const appForm = ref({ appKey: '' });
const appSaving = ref(false);

function openCreateApp() {
  appForm.value = { appKey: '' };
  appModal.value = 'create';
}

function openRenameApp() {
  if (!activeApp.value) {
    message.warning('请先选择一个应用');
    return;
  }
  appForm.value = { appKey: activeApp.value };
  appModal.value = 'rename';
}

async function submitApp() {
  const value = appForm.value.appKey.trim();
  if (!value) {
    message.warning('应用标识不能为空');
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    message.warning('应用标识只能包含字母、数字、下划线与连字符');
    return;
  }
  appSaving.value = true;
  try {
    if (appModal.value === 'create') {
      await createApp(value);
      message.success(`应用 ${value} 已创建`);
      activeApp.value = value;
    } else {
      await renameApp(activeApp.value, value);
      message.success(`应用已重命名为 ${value}`);
      activeApp.value = value;
    }
    appModal.value = null;
    await loadApps();
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '应用操作失败'));
  } finally {
    appSaving.value = false;
  }
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
const uploading = ref(false);
const uploadPercent = ref(0);
const uploadError = ref('');
const uploadResult = ref<AppVersionRecord | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pickedFile = ref<File | null>(null);
const pickedError = ref('');
const uploadForm = ref({
  appKey: '',
  versionName: '',
  versionCode: 1,
  updateLog: '',
  remark: '',
  scheduled: false,
  scheduledAt: null as number | null,
  scheduledMode: 'full' as 'full' | 'gray',
  scheduledGrayPercent: 20,
});
const MAX_APK = 500 * 1024 * 1024;

function openUpload() {
  uploadForm.value = {
    appKey: activeApp.value || apps.value[0] || '',
    versionName: '',
    versionCode: 1,
    updateLog: '',
    remark: '',
    scheduled: false,
    scheduledAt: null,
    scheduledMode: 'full',
    scheduledGrayPercent: 20,
  };
  pickedFile.value = null;
  pickedError.value = '';
  uploadError.value = '';
  uploadPercent.value = 0;
  uploadResult.value = null;
  uploadShow.value = true;
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  pickedFile.value = null;
  pickedError.value = '';
  uploadResult.value = null;
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.apk')) {
    pickedError.value = '文件扩展名必须为 .apk';
    input.value = '';
    return;
  }
  if (file.size <= 0) {
    pickedError.value = '文件为空';
    input.value = '';
    return;
  }
  if (file.size > MAX_APK) {
    pickedError.value = `文件超过 500MB 上限（当前 ${formatBytes(file.size)}）`;
    input.value = '';
    return;
  }

  // 客户端 ZIP 魔数校验（PK\x03\x04），与后端一致，提前拦截改名的非 APK 文件
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (
      head[0] !== 0x50 ||
      head[1] !== 0x4b ||
      head[2] !== 0x03 ||
      head[3] !== 0x04
    ) {
      pickedError.value = '文件内容不是合法的 APK（ZIP）包';
      input.value = '';
      return;
    }
  } catch {
    pickedError.value = '读取文件失败';
    input.value = '';
    return;
  }

  pickedFile.value = file;
  if (!uploadForm.value.versionName) {
    uploadForm.value.versionName = file.name.replace(/\.apk$/i, '');
  }
}

async function submitUpload() {
  const file = pickedFile.value;
  if (!file) {
    message.warning('请选择 APK 文件');
    return;
  }
  if (!uploadForm.value.appKey) {
    message.warning('请选择应用');
    return;
  }
  if (!uploadForm.value.versionName.trim()) {
    message.warning('请填写版本名');
    return;
  }
  if (!uploadForm.value.versionCode || uploadForm.value.versionCode <= 0) {
    message.warning('versionCode 必须大于 0');
    return;
  }
  if (uploadForm.value.scheduled) {
    if (!uploadForm.value.scheduledAt) {
      message.warning('请选择定时发布时间');
      return;
    }
    if (uploadForm.value.scheduledAt <= Date.now()) {
      message.warning('定时发布时间必须晚于当前时间');
      return;
    }
    if (
      uploadForm.value.scheduledMode === 'gray' &&
      (uploadForm.value.scheduledGrayPercent < 1 ||
        uploadForm.value.scheduledGrayPercent > 99)
    ) {
      message.warning('定时灰度百分比必须在 1~99');
      return;
    }
  }

  const form = new FormData();
  form.append('file', file, file.name);
  form.append('appKey', uploadForm.value.appKey);
  form.append('versionName', uploadForm.value.versionName.trim());
  form.append('versionCode', String(uploadForm.value.versionCode));
  if (uploadForm.value.updateLog.trim())
    form.append('updateLog', uploadForm.value.updateLog.trim());
  if (uploadForm.value.remark.trim())
    form.append('remark', uploadForm.value.remark.trim());
  if (uploadForm.value.scheduled && uploadForm.value.scheduledAt) {
    form.append('scheduledPublishAt', String(uploadForm.value.scheduledAt));
    form.append('scheduledPublishMode', uploadForm.value.scheduledMode);
    if (uploadForm.value.scheduledMode === 'gray') {
      form.append(
        'scheduledGrayPercent',
        String(uploadForm.value.scheduledGrayPercent),
      );
    }
  }

  uploading.value = true;
  uploadPercent.value = 0;
  uploadError.value = '';
  try {
    const result = await createVersion(form, (percent) => {
      uploadPercent.value = percent;
    });
    uploadResult.value = result;
    message.success('APK 上传成功，已创建草稿版本');
    activeApp.value = result.appKey;
    await loadVersions();
  } catch (e) {
    uploadError.value = getErrorMessage(e, 'APK 上传失败');
  } finally {
    uploading.value = false;
  }
}

function clearPicked() {
  pickedFile.value = null;
  pickedError.value = '';
  uploadResult.value = null;
  if (fileInput.value) fileInput.value.value = '';
}

// ===================== 发布 =====================
const publishShow = ref(false);
const publishing = ref(false);
const publishTarget = ref<AppVersionRecord | null>(null);
const publishForm = ref<{
  mode: 'full' | 'gray';
  grayPercent: number;
  autoIncrement: boolean;
  schedule: GrayIncrementStep[];
}>({ mode: 'full', grayPercent: 20, autoIncrement: false, schedule: [] });

function openPublish(version: AppVersionRecord) {
  publishTarget.value = version;
  publishForm.value = {
    mode: 'full',
    grayPercent:
      version.grayPercent > 0 ? Math.min(99, version.grayPercent) : 20,
    autoIncrement: false,
    schedule: [
      { hours: 24, percent: 50 },
      { hours: 72, percent: 100 },
    ],
  };
  publishShow.value = true;
}

function addScheduleStep() {
  publishForm.value.schedule.push({ hours: 24, percent: 50 });
}

function removeScheduleStep(index: number) {
  publishForm.value.schedule.splice(index, 1);
}

async function submitPublish() {
  const target = publishTarget.value;
  if (!target) return;
  const f = publishForm.value;
  if (f.mode === 'gray') {
    if (f.grayPercent < 1 || f.grayPercent > 99) {
      message.warning('灰度百分比必须在 1~99');
      return;
    }
    if (f.autoIncrement && f.schedule.length === 0) {
      message.warning('开启自动递增时必须提供至少一个递增步骤');
      return;
    }
    if (f.autoIncrement) {
      for (const step of f.schedule) {
        if (step.hours <= 0 || step.percent < 1 || step.percent > 100) {
          message.warning('递增步骤的 hours 需大于 0，percent 需在 1~100');
          return;
        }
      }
    }
  }
  const body: PublishBody = { mode: f.mode };
  if (f.mode === 'gray') {
    body.grayPercent = f.grayPercent;
    body.grayAutoIncrement = f.autoIncrement;
    if (f.autoIncrement) {
      body.grayIncrementSchedule = [...f.schedule].sort(
        (a, b) => a.hours - b.hours,
      );
    }
  }
  publishing.value = true;
  try {
    await publishVersion(target.id, body);
    message.success(
      f.mode === 'gray'
        ? `已灰度发布 v${target.versionName}（${f.grayPercent}%${f.autoIncrement ? '，自动递增' : ''}）`
        : `已全量发布 v${target.versionName}`,
    );
    publishShow.value = false;
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '发布失败'));
  } finally {
    publishing.value = false;
  }
}

// ===================== 强更 =====================
const forceShow = ref(false);
const savingForce = ref(false);
const forceTarget = ref<AppVersionRecord | null>(null);
const forceForm = ref({ forceUpdate: false, minVersionCode: 0 });

function openForce(version: AppVersionRecord) {
  forceTarget.value = version;
  forceForm.value = {
    forceUpdate: version.forceUpdate === 1,
    minVersionCode: version.minVersionCode,
  };
  forceShow.value = true;
}

async function submitForce() {
  const target = forceTarget.value;
  if (!target) return;
  savingForce.value = true;
  try {
    await setForceUpdate(target.id, {
      forceUpdate: forceForm.value.forceUpdate,
      minVersionCode: forceForm.value.minVersionCode,
    });
    message.success('强更配置已更新');
    forceShow.value = false;
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '强更配置更新失败'));
  } finally {
    savingForce.value = false;
  }
}

// ===================== 编辑 =====================
const editShow = ref(false);
const savingEdit = ref(false);
const editTarget = ref<AppVersionRecord | null>(null);
const editForm = ref({
  versionName: '',
  updateLog: '',
  remark: '',
  scheduled: false,
  scheduledAt: null as number | null,
  scheduledMode: 'full' as 'full' | 'gray',
  scheduledGrayPercent: 20,
});

function openEdit(version: AppVersionRecord) {
  editTarget.value = version;
  editForm.value = {
    versionName: version.versionName,
    updateLog: version.updateLog ?? '',
    remark: version.remark ?? '',
    scheduled: version.scheduledPublishAt !== null,
    scheduledAt: version.scheduledPublishAt,
    scheduledMode: version.scheduledPublishMode === 'gray' ? 'gray' : 'full',
    scheduledGrayPercent: version.scheduledGrayPercent || 20,
  };
  editShow.value = true;
}

async function submitEdit() {
  const target = editTarget.value;
  if (!target) return;
  if (!editForm.value.versionName.trim()) {
    message.warning('版本名不能为空');
    return;
  }
  if (editForm.value.scheduled) {
    if (!editForm.value.scheduledAt) {
      message.warning('请选择定时发布时间');
      return;
    }
    if (editForm.value.scheduledAt <= Date.now()) {
      message.warning('定时发布时间必须晚于当前时间');
      return;
    }
  }
  savingEdit.value = true;
  try {
    await updateVersion(target.id, {
      versionName: editForm.value.versionName.trim(),
      updateLog: editForm.value.updateLog,
      remark: editForm.value.remark,
      scheduledPublishAt: editForm.value.scheduled
        ? editForm.value.scheduledAt
        : null,
      scheduledPublishMode: editForm.value.scheduledMode,
      scheduledGrayPercent: editForm.value.scheduledGrayPercent,
    });
    message.success('版本信息已更新');
    editShow.value = false;
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '保存失败'));
  } finally {
    savingEdit.value = false;
  }
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
const rollingBack = ref(false);
const rollbackTarget = ref<AppVersionRecord | null>(null);
const rollbackCandidates = ref<RollbackCandidate[]>([]);
const rollbackLoading = ref(false);
const rollbackError = ref('');

async function openRollback(version: AppVersionRecord) {
  rollbackTarget.value = version;
  rollbackCandidates.value = [];
  rollbackError.value = '';
  rollbackShow.value = true;
  rollbackLoading.value = true;
  try {
    const result = await getRollbackCandidates(version.id);
    rollbackCandidates.value = result.candidates;
  } catch (e) {
    rollbackError.value = getErrorMessage(e, '回滚候选加载失败');
  } finally {
    rollbackLoading.value = false;
  }
}

async function confirmRollback() {
  const target = rollbackTarget.value;
  if (!target) return;
  rollingBack.value = true;
  try {
    const result = await rollbackVersion(target.id);
    message.success(
      `已回滚 v${target.versionName}，恢复 v${result.restored.versionName}（vc ${result.restored.versionCode}）上线`,
    );
    rollbackShow.value = false;
    await loadVersions();
  } catch (e) {
    message.error(getErrorMessage(e, '回滚失败'));
  } finally {
    rollingBack.value = false;
  }
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

/** 定时发布时间不允许选过去（后端同样拒绝） */
function isPastDate(timestamp: number) {
  return timestamp < Date.now() - 86_400_000;
}

onMounted(async () => {
  await loadApps();
  await loadVersions();
});
</script>

<template>
  <div class="flex flex-col gap-3 animate-fade-up">
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
    <section class="glass-panel px-4 py-3 flex flex-col gap-2">
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
        <NButton size="small" quaternary @click="loadVersions">
          <template #icon
            ><NIcon><RefreshOutline /></NIcon
          ></template>
          刷新
        </NButton>
        <span class="ml-auto text-11px text-ink-sub">
          共 {{ total }} 个版本 · 后端分页
        </span>
      </div>
    </section>

    <NSpin :show="loading">
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

        <footer class="glass-panel px-4 py-2 flex items-center justify-end">
          <NPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :item-count="total"
            :page-sizes="[10, 20, 50]"
            show-size-picker
            @update:page="loadVersions"
            @update:page-size="changeFilter"
          />
        </footer>
      </div>
    </NSpin>

    <!-- 应用创建/重命名 -->
    <NModal
      :show="appModal !== null"
      preset="card"
      :title="appModal === 'create' ? '新建应用' : '重命名应用'"
      class="w-460px! max-w-[94vw]"
      :bordered="false"
      @update:show="
        (value) => {
          if (!value) appModal = null;
        }
      "
    >
      <div class="flex flex-col gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">应用标识（appKey）</span>
          <NInput
            v-model:value="appForm.appKey"
            size="small"
            placeholder="如 xiaolv，仅字母/数字/下划线/连字符"
          />
        </label>
        <p class="m-0 text-11px text-ink-sub">
          应用标识同时是 software-update
          根下的目录名；重命名会迁移全部版本与事件记录。
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="appModal = null">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="appSaving"
            @click="submitApp"
            >保存</NButton
          >
        </div>
      </template>
    </NModal>

    <!-- APK 上传 -->
    <NModal
      v-model:show="uploadShow"
      preset="card"
      title="上传 APK"
      class="w-680px! max-w-[94vw]"
      :bordered="false"
    >
      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">应用</span>
            <NSelect
              v-model:value="uploadForm.appKey"
              size="small"
              :options="apps.map((a) => ({ label: a, value: a }))"
              placeholder="选择应用"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">版本名</span>
            <NInput
              v-model:value="uploadForm.versionName"
              size="small"
              placeholder="如 1.0.2"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">versionCode</span>
            <NInputNumber
              v-model:value="uploadForm.versionCode"
              size="small"
              :min="1"
              :max="2147483647"
            />
          </label>
        </div>

        <!-- 文件选择 -->
        <div
          class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-4 flex flex-col gap-2"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            class="hidden"
            @change="onFileChange"
          />
          <div v-if="!pickedFile" class="flex items-center gap-3 flex-wrap">
            <NButton size="small" @click="fileInput?.click()">
              <template #icon
                ><NIcon><CloudUploadOutline /></NIcon
              ></template>
              选择 APK 文件
            </NButton>
            <span class="text-11px text-ink-sub"
              >仅 .apk，最大 500MB；本地校验 ZIP 魔数</span
            >
          </div>
          <div v-else class="flex items-center gap-3 flex-wrap">
            <NIcon :size="18" class="text-brand-600 dark:text-brand-400"
              ><DocumentTextOutline
            /></NIcon>
            <span class="min-w-0 flex-1">
              <span class="block text-12px text-ink truncate">{{
                pickedFile.name
              }}</span>
              <span class="block text-11px text-ink-sub">{{
                formatBytes(pickedFile.size)
              }}</span>
            </span>
            <NButton
              size="tiny"
              quaternary
              :disabled="uploading"
              @click="clearPicked"
              >重新选择</NButton
            >
          </div>
          <p v-if="pickedError" class="m-0 text-12px text-red-500">
            {{ pickedError }}
          </p>
          <div
            v-if="uploading"
            class="h-2 rounded-full bg-ink-sub/10 overflow-hidden"
          >
            <div
              class="h-full rounded-full bg-gradient-to-r from-brand-600 to-brand-400 transition-all"
              :style="{ width: `${uploadPercent}%` }"
            />
          </div>
          <p v-if="uploading" class="m-0 text-11px text-ink-sub">
            上传中 {{ uploadPercent }}%
          </p>
          <p v-if="uploadError" class="m-0 text-12px text-red-500 leading-5">
            {{ uploadError }}
          </p>
          <div
            v-if="uploadResult"
            class="rounded-lg bg-brand-500/8 px-3 py-2 flex flex-col gap-1"
          >
            <span class="text-12px text-ink font-600"
              >上传成功 · 草稿已创建</span
            >
            <span class="text-10px text-ink-sub font-mono break-all"
              >SHA-256 {{ uploadResult.checksum }}</span
            >
            <span class="text-10px text-ink-sub"
              >大小 {{ formatBytes(uploadResult.packageSize) }}</span
            >
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">更新说明</span>
            <NInput
              v-model:value="uploadForm.updateLog"
              type="textarea"
              size="small"
              :rows="2"
              placeholder="支持换行"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">内部备注</span>
            <NInput
              v-model:value="uploadForm.remark"
              type="textarea"
              size="small"
              :rows="2"
              placeholder="仅管理端可见"
            />
          </label>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <NSwitch v-model:value="uploadForm.scheduled" size="small" />
            <span class="text-12px text-ink">创建后定时发布</span>
            <NTooltip :delay="300">
              <template #trigger>
                <NIcon :size="14" class="text-ink-sub"
                  ><InformationCircleOutline
                /></NIcon>
              </template>
              后端每 10 分钟扫描一次到点的草稿；发布失败会清除定时设置
            </NTooltip>
          </div>
          <div
            v-if="uploadForm.scheduled"
            class="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <label class="flex flex-col gap-1 sm:col-span-2">
              <span class="text-11px text-ink-sub">发布时间</span>
              <NDatePicker
                v-model:value="uploadForm.scheduledAt"
                type="datetime"
                size="small"
                clearable
                :is-date-disabled="isPastDate"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-11px text-ink-sub">发布模式</span>
              <NRadioGroup
                v-model:value="uploadForm.scheduledMode"
                size="small"
              >
                <NRadioButton value="full">全量</NRadioButton>
                <NRadioButton value="gray">灰度</NRadioButton>
              </NRadioGroup>
            </label>
            <label
              v-if="uploadForm.scheduledMode === 'gray'"
              class="flex flex-col gap-1"
            >
              <span class="text-11px text-ink-sub">灰度百分比</span>
              <NInputNumber
                v-model:value="uploadForm.scheduledGrayPercent"
                size="small"
                :min="1"
                :max="99"
              />
            </label>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <span class="text-11px text-ink-sub"
            >仅创建草稿，发布需前往版本操作</span
          >
          <div class="flex gap-2">
            <NButton
              size="small"
              :disabled="uploading"
              @click="uploadShow = false"
              >关闭</NButton
            >
            <NButton
              size="small"
              type="primary"
              :loading="uploading"
              :disabled="!pickedFile"
              @click="submitUpload"
            >
              上传并创建草稿
            </NButton>
          </div>
        </div>
      </template>
    </NModal>

    <!-- 发布 -->
    <NModal
      v-model:show="publishShow"
      preset="card"
      :title="`发布 v${publishTarget?.versionName ?? ''}`"
      class="w-560px! max-w-[94vw]"
      :bordered="false"
    >
      <div class="flex flex-col gap-3">
        <NRadioGroup v-model:value="publishForm.mode" size="small">
          <NRadioButton value="full">全量发布</NRadioButton>
          <NRadioButton value="gray">灰度发布</NRadioButton>
        </NRadioGroup>

        <template v-if="publishForm.mode === 'gray'">
          <label class="flex flex-col gap-1">
            <span class="text-12px text-ink-sub">灰度百分比（1~99）</span>
            <NInputNumber
              v-model:value="publishForm.grayPercent"
              size="small"
              :min="1"
              :max="99"
            />
          </label>

          <div class="flex items-center gap-2">
            <NSwitch v-model:value="publishForm.autoIncrement" size="small" />
            <span class="text-12px text-ink">灰度自动递增</span>
            <NTooltip :delay="300">
              <template #trigger>
                <NIcon :size="14" class="text-ink-sub"
                  ><InformationCircleOutline
                /></NIcon>
              </template>
              后端每小时按发布时间匹配递增表；percent 达 100 时自动转全量
            </NTooltip>
          </div>

          <div v-if="publishForm.autoIncrement" class="flex flex-col gap-2">
            <div
              v-for="(step, index) in publishForm.schedule"
              :key="index"
              class="flex items-center gap-2"
            >
              <span class="text-11px text-ink-sub shrink-0">发布后</span>
              <NInputNumber
                v-model:value="step.hours"
                size="tiny"
                :min="1"
                :max="8760"
                class="w-24"
              />
              <span class="text-11px text-ink-sub shrink-0">小时 →</span>
              <NInputNumber
                v-model:value="step.percent"
                size="tiny"
                :min="1"
                :max="100"
                class="w-24"
              />
              <span class="text-11px text-ink-sub shrink-0">%</span>
              <NButton
                size="tiny"
                quaternary
                type="error"
                :disabled="publishForm.schedule.length <= 1"
                @click="removeScheduleStep(index)"
              >
                <template #icon
                  ><NIcon><CloseCircleOutline /></NIcon
                ></template>
              </NButton>
            </div>
            <NButton
              size="tiny"
              quaternary
              class="self-start"
              @click="addScheduleStep"
            >
              <template #icon
                ><NIcon><AddOutline /></NIcon
              ></template>
              增加递增步骤
            </NButton>
          </div>
        </template>

        <p class="m-0 text-11px text-ink-sub leading-5">
          发布门禁：versionCode
          必须大于该应用当前全量最大版本；全量发布会把同应用旧的在线版本
          自动下架（offlineReason=auto，可被回滚恢复）。手动下架（manual）不会被回滚恢复。
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="publishShow = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="publishing"
            @click="submitPublish"
          >
            确认发布
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- 强更 -->
    <NModal
      v-model:show="forceShow"
      preset="card"
      :title="`强更配置 v${forceTarget?.versionName ?? ''}`"
      class="w-480px! max-w-[94vw]"
      :bordered="false"
    >
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <NSwitch v-model:value="forceForm.forceUpdate" size="small" />
          <span class="text-12px text-ink">强制更新（forceUpdate）</span>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub"
            >最低版本号（minVersionCode）</span
          >
          <NInputNumber
            v-model:value="forceForm.minVersionCode"
            size="small"
            :min="0"
            :max="2147483647"
          />
        </label>
        <p class="m-0 text-11px text-ink-sub leading-5">
          客户端版本号低于 minVersionCode
          时也视为强制更新；该开关可随时远程修改，无需重新发版。
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="forceShow = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="savingForce"
            @click="submitForce"
            >保存</NButton
          >
        </div>
      </template>
    </NModal>

    <!-- 编辑 -->
    <NModal
      v-model:show="editShow"
      preset="card"
      :title="`编辑 v${editTarget?.versionName ?? ''}`"
      class="w-600px! max-w-[94vw]"
      :bordered="false"
    >
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub"
            >版本名（versionCode 与安装包不可修改）</span
          >
          <NInput v-model:value="editForm.versionName" size="small" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">更新说明</span>
          <NInput
            v-model:value="editForm.updateLog"
            type="textarea"
            size="small"
            :rows="3"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">内部备注</span>
          <NInput
            v-model:value="editForm.remark"
            type="textarea"
            size="small"
            :rows="2"
          />
        </label>

        <div class="flex items-center gap-2">
          <NSwitch v-model:value="editForm.scheduled" size="small" />
          <span class="text-12px text-ink">定时发布</span>
        </div>
        <div
          v-if="editForm.scheduled"
          class="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          <label class="flex flex-col gap-1 sm:col-span-2">
            <span class="text-11px text-ink-sub">发布时间</span>
            <NDatePicker
              v-model:value="editForm.scheduledAt"
              type="datetime"
              size="small"
              clearable
            />
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-11px text-ink-sub">模式</span>
            <NRadioGroup v-model:value="editForm.scheduledMode" size="small">
              <NRadioButton value="full">全量</NRadioButton>
              <NRadioButton value="gray">灰度</NRadioButton>
            </NRadioGroup>
          </label>
          <label
            v-if="editForm.scheduledMode === 'gray'"
            class="flex flex-col gap-1"
          >
            <span class="text-11px text-ink-sub">灰度百分比</span>
            <NInputNumber
              v-model:value="editForm.scheduledGrayPercent"
              size="small"
              :min="1"
              :max="99"
            />
          </label>
        </div>
        <p class="m-0 text-11px text-ink-sub">
          仅草稿/已下架版本可编辑，发布中的版本需先下架。
        </p>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="editShow = false">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="savingEdit"
            @click="submitEdit"
            >保存</NButton
          >
        </div>
      </template>
    </NModal>

    <!-- 下架 -->
    <ConfirmModal
      v-model:show="offlineShow"
      title="手动下架版本"
      :content="`下架后该版本对客户端立即不可见（检查与下载均返回不存在），APK 文件保留。\n该版本会被标记为「手动下架」（offlineReason=manual），回滚不会自动恢复它。\n目标：${offlineTarget?.appKey ?? ''} v${offlineTarget?.versionName ?? ''}（vc ${offlineTarget?.versionCode ?? ''}）`"
      positive-text="确认下架"
      :loading="offlining"
      @confirm="confirmOffline"
    />

    <!-- 回滚 -->
    <NModal
      v-model:show="rollbackShow"
      preset="card"
      :title="`回滚 v${rollbackTarget?.versionName ?? ''}`"
      class="w-560px! max-w-[94vw]"
      :bordered="false"
    >
      <NSpin :show="rollbackLoading">
        <div class="flex flex-col gap-3">
          <p class="m-0 text-12px text-ink-sub leading-5">
            回滚会把当前版本手动下架，并恢复该应用历史中可恢复的最高版本上线。
            候选仅包含「全量在线」与「自动下架（被新全量顶替）」的版本；手动下架的版本不会恢复。
          </p>

          <div v-if="rollbackError" class="text-12px text-red-500">
            {{ rollbackError }}
          </div>
          <div
            v-else-if="!rollbackLoading && rollbackCandidates.length === 0"
            class="rounded-xl border border-dashed border-glass-border dark:border-glass-border-dark px-4 py-5 text-center"
          >
            <NIcon :size="22" class="text-ink-sub"
              ><InformationCircleOutline
            /></NIcon>
            <p class="m-0 mt-2 text-12px text-ink-sub">
              当前应用不存在可回滚的历史全量版本（后端会拒绝本次回滚）。
            </p>
          </div>
          <div v-else class="flex flex-col gap-1">
            <div
              v-for="(candidate, index) in rollbackCandidates"
              :key="candidate.id"
              class="flex items-center gap-2 rounded-lg px-3 py-2"
              :class="
                index === 0 ? 'bg-brand-500/10' : 'bg-white/40 dark:bg-white/4'
              "
            >
              <NIcon
                :size="15"
                :class="
                  index === 0
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-ink-sub'
                "
              >
                <CheckmarkCircleOutline v-if="index === 0" />
                <TimeOutline v-else />
              </NIcon>
              <span class="text-12px text-ink flex-1">
                v{{ candidate.versionName }}
                <span class="text-11px text-ink-sub"
                  >vc {{ candidate.versionCode }}</span
                >
              </span>
              <span class="text-11px text-ink-sub">
                {{
                  candidate.status === APP_VERSION_STATUS.PUBLISHED
                    ? '全量在线'
                    : '自动下架'
                }}
              </span>
              <NTag
                v-if="index === 0"
                size="tiny"
                type="success"
                :bordered="false"
                >将恢复</NTag
              >
            </div>
          </div>

          <p class="m-0 text-11px text-ink-sub">
            注意：回滚后当前版本为「手动下架」状态；若需再次上线，可在版本列表点击「重新发布」。
          </p>
        </div>
      </NSpin>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton size="small" @click="rollbackShow = false">取消</NButton>
          <NButton
            size="small"
            type="error"
            :loading="rollingBack"
            :disabled="
              rollbackLoading ||
              rollbackCandidates.length === 0 ||
              Boolean(rollbackError)
            "
            @click="confirmRollback"
          >
            确认回滚
          </NButton>
        </div>
      </template>
    </NModal>

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
