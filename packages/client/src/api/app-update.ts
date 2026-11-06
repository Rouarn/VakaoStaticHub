import type {
  AppVersion,
  AppVersionStatus,
  FunnelStatItem,
  FunnelStatsResult,
  GrayIncrementStep,
  ListVersionsQuery,
  PagedResult,
  RollbackCandidate,
  RollbackCandidatesResult,
  RollbackResult,
} from '@vakao/shared';
import type { RequestOptions } from '@vakao-ui/axios';
import { http } from '@/utils/http';
import { getApiBaseUrl } from '@/utils/file-url';

/** 后端 AppVersionEntity 与 shared AppVersion 字段一致 */
export type AppVersionRecord = AppVersion;

export const APP_VERSION_STATUS = {
  DRAFT: 0,
  GRAY: 1,
  PUBLISHED: 2,
  OFFLINE: 3,
} as const;

export const STATUS_META: Record<
  number,
  { label: string; tag: 'default' | 'warning' | 'success' | 'error' }
> = {
  0: { label: '草稿', tag: 'default' },
  1: { label: '灰度中', tag: 'warning' },
  2: { label: '全量在线', tag: 'success' },
  3: { label: '已下架', tag: 'error' },
};

interface ServerApp {
  appKey: string;
  name: string;
  platform: string;
  createdAt: string;
  updatedAt: string;
}

interface ServerGrayStep {
  afterMinutes: number;
  percent: number;
}

interface ServerAppVersion {
  id: number;
  platform: string;
  appKey: string;
  versionName: string;
  versionCode: number;
  fileSize: number;
  checksum: string;
  storageRootId: string;
  category: string;
  relPath: string;
  updateLog?: string;
  forceUpdate: boolean;
  minVersionCode: number;
  grayPercent: number;
  grayAutoIncrement: boolean;
  grayIncrementSchedule?: ServerGrayStep[];
  scheduledPublishAt?: string;
  scheduledPublishMode?: string;
  scheduledGrayPercent?: number;
  status: 'draft' | 'published' | 'offline';
  offlineReason?: string;
  publishTime?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

interface ServerPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function statusOf(version: ServerAppVersion): AppVersionStatus {
  if (version.status === 'draft') return APP_VERSION_STATUS.DRAFT;
  if (version.status === 'offline') return APP_VERSION_STATUS.OFFLINE;
  return version.grayPercent < 100
    ? APP_VERSION_STATUS.GRAY
    : APP_VERSION_STATUS.PUBLISHED;
}

function offlineReasonOf(version: ServerAppVersion): 'auto' | 'manual' | null {
  const reason = version.offlineReason?.trim();
  if (!reason) return null;
  return reason.toLowerCase().includes('manual') ? 'manual' : 'auto';
}

function scheduleOf(version: ServerAppVersion): string | null {
  const steps = version.grayIncrementSchedule ?? [];
  if (steps.length === 0) return null;
  return JSON.stringify(
    steps.map((step) => ({
      hours: Math.max(1, Math.round(step.afterMinutes / 60)),
      percent: step.percent,
    })),
  );
}

function toAppVersion(version: ServerAppVersion): AppVersionRecord {
  return {
    id: version.id,
    platform: version.platform,
    appKey: version.appKey,
    versionName: version.versionName,
    versionCode: version.versionCode,
    updateType: 'apk',
    packageSize: version.fileSize,
    checksum: version.checksum,
    storageRootId: version.storageRootId,
    category: version.category,
    relPath: version.relPath,
    updateLog: version.updateLog ? version.updateLog : null,
    forceUpdate: version.forceUpdate ? 1 : 0,
    minVersionCode: version.minVersionCode,
    grayPercent: version.grayPercent,
    grayAutoIncrement: version.grayAutoIncrement ? 1 : 0,
    grayIncrementSchedule: scheduleOf(version),
    scheduledPublishAt: version.scheduledPublishAt
      ? new Date(version.scheduledPublishAt).getTime()
      : null,
    scheduledPublishMode: version.scheduledPublishMode || 'full',
    scheduledGrayPercent: version.scheduledGrayPercent ?? 0,
    status: statusOf(version),
    offlineReason: offlineReasonOf(version),
    publishTime: version.publishTime
      ? new Date(version.publishTime).getTime()
      : null,
    remark: version.remark ? version.remark : null,
    createdAt: new Date(version.createdAt).getTime(),
    updatedAt: new Date(version.updatedAt).getTime(),
  };
}

export async function listApps() {
  const apps = await http.get<ServerApp[]>('/apps');
  return apps.map((app) => app.appKey);
}

export async function createApp(appKey: string) {
  const created = await http.post<ServerApp>('/apps', { appKey });
  return { appKey: created.appKey };
}

export async function renameApp(appKey: string, newAppKey: string) {
  const updated = await http.patch<ServerApp>(
    `/apps/${encodeURIComponent(appKey)}`,
    { appKey: newAppKey },
  );
  return { appKey: updated.appKey };
}

export async function deleteApp(appKey: string) {
  const result = await http.delete<{
    versionCount: number;
    eventCount: number;
  }>(`/apps/${encodeURIComponent(appKey)}`);
  return {
    versionCount: result.versionCount,
    eventCount: result.eventCount,
    fileCount: result.versionCount,
  };
}

/** 单个版本详情（GET /api/v1/app-versions/:id） */
export async function getVersion(id: number) {
  const version = await http.get<ServerAppVersion>(`/app-versions/${id}`);
  return toAppVersion(version);
}

function statusQuery(status?: number): string | undefined {
  switch (status) {
    case APP_VERSION_STATUS.DRAFT:
      return 'draft';
    case APP_VERSION_STATUS.GRAY:
      return 'gray';
    case APP_VERSION_STATUS.PUBLISHED:
      return 'full';
    case APP_VERSION_STATUS.OFFLINE:
      return 'offline';
    default:
      return undefined;
  }
}

export async function listVersions(params: ListVersionsQuery) {
  if (!params.appKey) {
    return { items: [], total: 0, page: 1, pageSize: params.pageSize ?? 20 };
  }
  const page = await http.get<ServerPage<ServerAppVersion>>(
    `/apps/${encodeURIComponent(params.appKey)}/versions`,
    {
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
      ...(params.platform ? { platform: params.platform } : {}),
      ...(statusQuery(params.status)
        ? { status: statusQuery(params.status) }
        : {}),
    },
  );
  return {
    items: page.items.map(toAppVersion),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  } satisfies PagedResult<AppVersionRecord>;
}

export async function updateVersion(
  id: number,
  body: {
    versionName?: string;
    updateLog?: string;
    remark?: string;
    scheduledPublishAt?: number | null;
    scheduledPublishMode?: 'full' | 'gray';
    scheduledGrayPercent?: number;
  },
) {
  const version = await http.patch<ServerAppVersion>(
    `/app-versions/${id}`,
    body,
  );
  return toAppVersion(version);
}

export interface PublishBody {
  mode: 'full' | 'gray';
  grayPercent?: number;
  grayAutoIncrement?: boolean;
  grayIncrementSchedule?: GrayIncrementStep[];
}

export async function publishVersion(id: number, body: PublishBody) {
  const version = await http.post<ServerAppVersion>(
    `/app-versions/${id}/publish`,
    body,
  );
  return toAppVersion(version);
}

export async function setForceUpdate(
  id: number,
  body: { forceUpdate: boolean; minVersionCode?: number },
) {
  const version = await http.put<ServerAppVersion>(
    `/app-versions/${id}/force`,
    {
      forceUpdate: body.forceUpdate,
      minVersionCode: body.minVersionCode ?? 0,
    },
  );
  return toAppVersion(version);
}

export async function offlineVersion(id: number) {
  const version = await http.post<ServerAppVersion>(
    `/app-versions/${id}/offline`,
    {},
  );
  return toAppVersion(version);
}

/**
 * 一键回滚到指定历史版本。
 *
 * 控制器语义：路径中的版本即「要恢复上线的版本」，服务端会自动把当前
 * 更新的已发布版本置为下架。
 */
export async function rollbackVersion(id: number) {
  const restored = await http.post<ServerAppVersion>(
    `/app-versions/${id}/rollback`,
    {},
  );
  const version = toAppVersion(restored);
  return {
    success: true,
    rolledBack: { id, versionCode: 0 },
    restored: {
      id: version.id,
      versionCode: version.versionCode,
      versionName: version.versionName,
    },
  } satisfies RollbackResult;
}

/** 回滚候选：由后端按同应用同平台口径计算（排除手动下架） */
export async function getRollbackCandidates(id: number) {
  const result = await http.get<{ candidates: ServerAppVersion[] }>(
    `/app-versions/${id}/rollback-candidates`,
  );
  const candidates = result.candidates.map(
    (version) =>
      ({
        id: version.id,
        versionCode: version.versionCode,
        versionName: version.versionName,
        status: statusOf(version),
        offlineReason: offlineReasonOf(version),
      }) satisfies RollbackCandidate,
  );
  return { candidates } satisfies RollbackCandidatesResult;
}

export async function deleteVersion(id: number) {
  await http.delete(`/app-versions/${id}`);
  return { eventCount: 0, fileCount: 1 };
}

function percent(dividend: number, divisor: number): string {
  if (!divisor) return '0%';
  return `${(Math.round((dividend / divisor) * 1000) / 10).toFixed(1)}%`;
}

export async function getFunnelStats(
  appKey: string,
  startTime?: number,
  endTime?: number,
) {
  const result = await http.get<{
    appKey: string;
    items: Array<{
      toVersionCode: number;
      versionName: string;
      events: Record<string, number>;
    }>;
    checkNoUpdateTotal: number;
  }>(`/apps/${encodeURIComponent(appKey)}/funnel`, {
    ...(startTime ? { startTime: new Date(startTime).toISOString() } : {}),
    ...(endTime ? { endTime: new Date(endTime).toISOString() } : {}),
  });

  const items = result.items.map((item) => {
    const event = (name: string) => item.events[name] ?? 0;
    const promptShow = event('prompt_show');
    const downloadStart = event('download_start');
    const downloadSuccess = event('download_success');
    const installSuccess = event('install_success');
    return {
      toVersionCode: item.toVersionCode,
      versionName: item.versionName,
      checkNoUpdate: event('check_no_update'),
      promptShow,
      downloadStart,
      downloadSuccess,
      downloadFail: event('download_fail'),
      verifyFail: event('verify_fail'),
      installSuccess,
      installFail: event('install_fail'),
      newVersionLaunch: event('new_version_launch'),
      downloadRate: percent(downloadStart, promptShow),
      installRate: percent(installSuccess, downloadSuccess),
      overallRate: percent(installSuccess, promptShow),
    } satisfies FunnelStatItem;
  });

  return {
    appKey: result.appKey,
    items,
    checkNoUpdateTotal: result.checkNoUpdateTotal,
  } satisfies FunnelStatsResult;
}

/** APK 上传（multipart 字段名 file；后端校验 ZIP/APK 魔数并计算 SHA-256） */
export async function createVersion(
  form: FormData,
  onProgress?: (percent: number) => void,
) {
  const rawAppKey = form.get('appKey');
  const appKey = typeof rawAppKey === 'string' ? rawAppKey.trim() : '';
  if (!appKey) throw new Error('缺少应用标识');
  const options: RequestOptions = { timeout: 300000 };
  if (onProgress) {
    options.onUploadProgress = (event) => {
      if (event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
  }
  const version = await http.upload<ServerAppVersion>(
    `/apps/${encodeURIComponent(appKey)}/versions`,
    form,
    options,
  );
  return toAppVersion(version);
}

export function getApkDownloadUrl(id: number) {
  return `${getApiBaseUrl()}/public/apps/versions/${id}/download`;
}
