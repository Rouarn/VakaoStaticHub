import type {
  AppVersion,
  FunnelStatsResult,
  GrayIncrementStep,
  ListVersionsQuery,
  PagedResult,
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

export function listApps() {
  return http.get<string[]>('/app-updates/apps');
}

export function createApp(appKey: string) {
  return http.post<{ appKey: string }>('/app-updates/apps', { appKey });
}

export function renameApp(appKey: string, newAppKey: string) {
  return http.patch<{ appKey: string }>(
    `/app-updates/apps/${encodeURIComponent(appKey)}`,
    { newAppKey },
  );
}

export function deleteApp(appKey: string) {
  return http.delete<{
    versionCount: number;
    eventCount: number;
    fileCount: number;
  }>(`/app-updates/apps/${encodeURIComponent(appKey)}`);
}

export function listVersions(params: ListVersionsQuery) {
  return http.get<PagedResult<AppVersionRecord>>(
    '/app-updates/versions',
    params,
  );
}

export function updateVersion(
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
  return http.patch<AppVersionRecord>(`/app-updates/versions/${id}`, body);
}

export interface PublishBody {
  mode: 'full' | 'gray';
  grayPercent?: number;
  grayAutoIncrement?: boolean;
  grayIncrementSchedule?: GrayIncrementStep[];
}

export function publishVersion(id: number, body: PublishBody) {
  return http.post<AppVersionRecord>(
    `/app-updates/versions/${id}/publish`,
    body,
  );
}

export function setForceUpdate(
  id: number,
  body: { forceUpdate: boolean; minVersionCode?: number },
) {
  return http.put<AppVersionRecord>(`/app-updates/versions/${id}/force`, body);
}

export function offlineVersion(id: number) {
  return http.post<AppVersionRecord>(`/app-updates/versions/${id}/offline`);
}

export function rollbackVersion(id: number) {
  return http.post<RollbackResult>(`/app-updates/versions/${id}/rollback`);
}

/** 回滚候选：由后端按同应用同平台口径计算（排除手动下架） */
export function getRollbackCandidates(id: number) {
  return http.get<RollbackCandidatesResult>(
    `/app-updates/versions/${id}/rollback-candidates`,
  );
}

export function deleteVersion(id: number) {
  return http.delete<{ eventCount: number; fileCount: number }>(
    `/app-updates/versions/${id}`,
  );
}

export function getFunnelStats(
  appKey: string,
  startTime?: number,
  endTime?: number,
) {
  return http.get<FunnelStatsResult>('/app-updates/versions/stats/funnel', {
    appKey,
    startTime,
    endTime,
  });
}

/** APK 上传（multipart 字段名 file；后端校验 ZIP/APK 魔数并计算 SHA-256） */
export function createVersion(
  form: FormData,
  onProgress?: (percent: number) => void,
) {
  const options: RequestOptions = { timeout: 300000 };
  if (onProgress) {
    options.onUploadProgress = (event) => {
      if (event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
  }
  return http.upload<AppVersionRecord>('/app-updates/versions', form, options);
}

export function getApkDownloadUrl(id: number) {
  return `${getApiBaseUrl()}/app-updates/download/${id}`;
}
