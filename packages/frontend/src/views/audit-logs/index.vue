<script setup lang="ts">
import { h, onMounted, ref } from 'vue';
import {
  NCard,
  NDataTable,
  NButton,
  NTag,
  NInput,
  NSelect,
  NDatePicker,
  NModal,
  NDescriptions,
  NDescriptionsItem,
  NIcon,
  NSpin,
  useMessage,
  type DataTableColumns,
  type SelectOption,
} from 'naive-ui';
import {
  DocumentTextOutline,
  RefreshOutline,
  SearchOutline,
} from '@vicons/ionicons5';
import { getAuditLogs, type AuditLog, type AuditLogQuery } from '@/api/system';
import { getErrorMessage } from '@/utils/request';

defineOptions({
  name: 'audit-logs',
});

const message = useMessage();
const loading = ref(false);

// 常用操作动作选项（与后端埋点 action 保持一致）
const actionOptions: SelectOption[] = [
  { label: '登录', value: 'user.login' },
  { label: '注册用户', value: 'user.register' },
  { label: '删除用户', value: 'user.delete' },
  { label: '登出', value: 'user.logout' },
  { label: '修改密码', value: 'user.change_password' },
  { label: '上传文件', value: 'file.upload' },
  { label: '删除文件', value: 'file.delete' },
  { label: '重命名文件', value: 'file.rename' },
  { label: '批量删除文件', value: 'file.batch_delete' },
  { label: '批量移动文件', value: 'file.batch_move' },
  { label: '重命名分类', value: 'category.rename' },
  { label: '创建分享', value: 'share.create' },
  { label: '撤销分享', value: 'share.revoke' },
  { label: '新建应用', value: 'app.create' },
  { label: '重命名应用', value: 'app.rename' },
  { label: '删除应用', value: 'app.delete' },
  { label: '发布版本', value: 'app_version.publish' },
  { label: '修改强更开关', value: 'app_version.force_update' },
  { label: '下架版本', value: 'app_version.offline' },
  { label: '回滚版本', value: 'app_version.rollback' },
  { label: '删除版本', value: 'app_version.delete' },
];

const resourceTypeOptions: SelectOption[] = [
  { label: '文件', value: 'file' },
  { label: '分类', value: 'category' },
  { label: '分享链接', value: 'share' },
  { label: '用户', value: 'user' },
  { label: 'APP 版本', value: 'app_version' },
  { label: '应用', value: 'app' },
];

/** 动作值 → 中文标签映射（未知值回退到原始值） */
const actionLabelMap = new Map<string, string>(
  actionOptions.map((o) => [o.value as string, o.label as string]),
);
/** 资源类型值 → 中文标签映射 */
const resourceTypeLabelMap = new Map<string, string>(
  resourceTypeOptions.map((o) => [o.value as string, o.label as string]),
);
function getActionLabel(action: string): string {
  return actionLabelMap.get(action) ?? action;
}
function getResourceTypeLabel(type: string): string {
  return resourceTypeLabelMap.get(type) ?? type;
}

// 筛选表单
const filterUsername = ref('');
const filterAction = ref<string | null>(null);
const filterResourceType = ref<string | null>(null);
const filterTimeRange = ref<[number, number] | null>(null);

// 分页与数据
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const logs = ref<AuditLog[]>([]);

// 详情弹窗
const detailTarget = ref<AuditLog | null>(null);
const showDetail = ref(false);

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 动作标签颜色映射 */
function actionTagType(
  action: string,
): 'default' | 'error' | 'warning' | 'success' | 'info' {
  if (
    action.endsWith('.delete') ||
    action.endsWith('.offline') ||
    action === 'share.revoke'
  ) {
    return 'error';
  }
  if (
    action.endsWith('.publish') ||
    action.endsWith('.login') ||
    action.endsWith('.register')
  ) {
    return 'success';
  }
  if (
    action.endsWith('.rollback') ||
    action.endsWith('.rename') ||
    action.endsWith('.batch_move')
  ) {
    return 'warning';
  }
  return 'info';
}

/** 将 details JSON 字符串美化为可读文本 */
function prettyDetails(details: string | null): string {
  if (!details) return '-';
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}

async function loadLogs() {
  loading.value = true;
  try {
    const params: AuditLogQuery = {
      page: page.value,
      pageSize: pageSize.value,
    };
    if (filterUsername.value.trim()) {
      params.username = filterUsername.value.trim();
    }
    if (filterAction.value) params.action = filterAction.value;
    if (filterResourceType.value)
      params.resourceType = filterResourceType.value;
    if (filterTimeRange.value) {
      params.startTime = filterTimeRange.value[0];
      params.endTime = filterTimeRange.value[1];
    }

    const result = await getAuditLogs(params);
    logs.value = result.items;
    total.value = result.total;
  } catch (error) {
    message.error(getErrorMessage(error, '加载审计日志失败'));
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  page.value = 1;
  loadLogs();
}

function handleReset() {
  filterUsername.value = '';
  filterAction.value = null;
  filterResourceType.value = null;
  filterTimeRange.value = null;
  page.value = 1;
  loadLogs();
}

function handlePageChange(p: number) {
  page.value = p;
  loadLogs();
}

function handlePageSizeChange(size: number) {
  pageSize.value = size;
  page.value = 1;
  loadLogs();
}

function openDetail(row: AuditLog) {
  detailTarget.value = row;
  showDetail.value = true;
}

/**
 * 表格内容的最小宽度（各固定列宽度 + 弹性列「资源标识」最小 200）
 * 窄屏（移动端）表格按此宽度内部横向滚动，宽屏下弹性列自动撑满剩余空间
 */
const TABLE_SCROLL_X = 970;

const columns: DataTableColumns<AuditLog> = [
  {
    title: '时间',
    key: 'createdAt',
    width: 180,
    render: (row) => formatTime(row.createdAt),
  },
  { title: '用户', key: 'username', width: 120 },
  {
    title: '动作',
    key: 'action',
    width: 140,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: actionTagType(row.action),
          bordered: false,
          title: row.action,
        },
        {
          default: () => getActionLabel(row.action),
        },
      ),
  },
  {
    title: '资源类型',
    key: 'resourceType',
    width: 100,
    render: (row) =>
      h(
        NTag,
        { size: 'small', bordered: false, title: row.resourceType },
        { default: () => getResourceTypeLabel(row.resourceType) },
      ),
  },
  {
    title: '资源标识',
    key: 'resourceId',
    ellipsis: { tooltip: true },
    render: (row) => row.resourceId ?? '-',
  },
  {
    title: 'IP',
    key: 'ip',
    width: 140,
    render: (row) => row.ip ?? '-',
  },
  {
    title: '操作',
    key: 'actions',
    width: 90,
    render: (row) =>
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          onClick: () => openDetail(row),
        },
        {
          icon: () => h(NIcon, null, { default: () => h(DocumentTextOutline) }),
          default: () => '详情',
        },
      ),
  },
];

onMounted(loadLogs);
</script>

<template>
  <main class="px-4 md:px-6 pb-4">
    <div
      class="flex items-center justify-between py-4 mb-4 sticky top-0 z-2 bg-container/95 backdrop-blur border-b border-base shadow-sm -mx-4 md:-mx-6 px-4 md:px-6"
    >
      <h2 class="text-xl font-semibold text-base">操作审计日志</h2>
      <NButton
        quaternary
        circle
        title="刷新"
        :loading="loading"
        @click="loadLogs"
      >
        <template #icon>
          <NIcon><RefreshOutline /></NIcon>
        </template>
      </NButton>
    </div>

    <NCard size="small" class="mb-4">
      <div class="flex flex-wrap items-center gap-3">
        <NInput
          v-model:value="filterUsername"
          placeholder="用户名"
          clearable
          class="w-36"
          @keyup.enter="handleSearch"
        />
        <NSelect
          v-model:value="filterAction"
          :options="actionOptions"
          placeholder="操作动作"
          clearable
          class="w-44"
        />
        <NSelect
          v-model:value="filterResourceType"
          :options="resourceTypeOptions"
          placeholder="资源类型"
          clearable
          class="w-36"
        />
        <NDatePicker
          v-model:value="filterTimeRange"
          type="datetimerange"
          clearable
          start-placeholder="开始时间"
          end-placeholder="结束时间"
        />
        <NButton type="primary" size="small" @click="handleSearch">
          <template #icon>
            <NIcon><SearchOutline /></NIcon>
          </template>
          查询
        </NButton>
        <NButton size="small" @click="handleReset">重置</NButton>
      </div>
    </NCard>

    <NCard size="small">
      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="logs"
          :scroll-x="TABLE_SCROLL_X"
          :row-key="(row: AuditLog) => row.id"
          :pagination="{
            page,
            pageSize,
            itemCount: total,
            showSizePicker: true,
            pageSizes: [20, 50, 100],
            prefix: () => `共 ${total} 条`,
            onChange: handlePageChange,
            onUpdatePageSize: handlePageSizeChange,
          }"
        />
      </NSpin>
    </NCard>

    <NModal
      v-model:show="showDetail"
      preset="card"
      title="审计日志详情"
      style="max-width: 640px"
    >
      <NDescriptions
        v-if="detailTarget"
        label-placement="left"
        bordered
        :column="1"
        size="small"
      >
        <NDescriptionsItem label="时间">
          {{ formatTime(detailTarget.createdAt) }}
        </NDescriptionsItem>
        <NDescriptionsItem label="用户">
          {{ detailTarget.username }}（ID: {{ detailTarget.userId ?? '-' }}）
        </NDescriptionsItem>
        <NDescriptionsItem label="动作">
          <NTag
            size="small"
            :type="actionTagType(detailTarget.action)"
            :bordered="false"
          >
            {{ getActionLabel(detailTarget.action) }}
            <span class="text-gray-400 ml-1">({{ detailTarget.action }})</span>
          </NTag>
        </NDescriptionsItem>
        <NDescriptionsItem label="资源">
          {{ getResourceTypeLabel(detailTarget.resourceType) }}
          <span class="text-gray-400">({{ detailTarget.resourceType }})</span>
          / {{ detailTarget.resourceId ?? '-' }}
        </NDescriptionsItem>
        <NDescriptionsItem label="IP 地址">
          {{ detailTarget.ip ?? '-' }}
        </NDescriptionsItem>
        <NDescriptionsItem label="User-Agent">
          <span class="break-all">{{ detailTarget.userAgent ?? '-' }}</span>
        </NDescriptionsItem>
        <NDescriptionsItem label="操作详情">
          <pre class="whitespace-pre-wrap break-all text-xs m-0">{{
            prettyDetails(detailTarget.details)
          }}</pre>
        </NDescriptionsItem>
      </NDescriptions>
    </NModal>
  </main>
</template>
