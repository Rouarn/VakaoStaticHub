import { request } from '../utils/request';
import type { RequestOptions } from '@vakao-ui/axios';
import type {
  PagedResult,
  AppVersion,
  ListVersionsQuery,
  GrayIncrementStep,
  RollbackResult,
  FunnelStatsResult,
} from '@vakao/shared';

export type { FunnelStatItem, GrayIncrementStep } from '@vakao/shared';

export type ListVersionsParams = ListVersionsQuery;

/** 获取全部应用标识（software-update 根下的分类目录） */
export function getApps() {
  return request.get<string[]>('/app-updates/apps');
}

/** 新建应用（创建应用目录） */
export function createApp(appKey: string) {
  return request.post<{ appKey: string }>('/app-updates/apps', { appKey });
}

/** 修改应用标识（重命名目录，迁移全部版本/事件/索引记录） */
export function renameApp(appKey: string, newAppKey: string) {
  return request.patch<{ appKey: string }>(
    `/app-updates/apps/${encodeURIComponent(appKey)}`,
    { newAppKey },
  );
}

/** 删除应用（删除整个目录及全部关联数据库记录，不可恢复） */
export function deleteApp(appKey: string) {
  return request.delete<{
    success: true;
    versionCount: number;
    eventCount: number;
    fileCount: number;
  }>(`/app-updates/apps/${encodeURIComponent(appKey)}`);
}

export function getVersions(params: ListVersionsParams) {
  return request.get<PagedResult<AppVersion>>('/app-updates/versions', params);
}

export function getVersion(id: number) {
  return request.get<AppVersion>(`/app-updates/versions/${id}`);
}

/**
 * 上传 APK 创建草稿版本
 * 大文件必须单独传 timeout: 0 覆盖全局 10s 超时，并携带上传进度回调
 */
export function createVersion(
  payload: {
    file: File;
    appKey: string;
    versionName: string;
    versionCode: number;
    updateLog?: string;
    remark?: string;
    scheduledPublishAt?: number;
    scheduledPublishMode?: 'full' | 'gray';
    scheduledGrayPercent?: number;
  },
  onUploadProgress?: RequestOptions['onUploadProgress'],
) {
  const fd = new FormData();
  fd.append('file', payload.file);
  fd.append('appKey', payload.appKey);
  fd.append('versionName', payload.versionName);
  fd.append('versionCode', String(payload.versionCode));
  if (payload.updateLog) fd.append('updateLog', payload.updateLog);
  if (payload.remark) fd.append('remark', payload.remark);
  if (payload.scheduledPublishAt !== undefined) {
    fd.append('scheduledPublishAt', String(payload.scheduledPublishAt));
  }
  if (payload.scheduledPublishMode) {
    fd.append('scheduledPublishMode', payload.scheduledPublishMode);
  }
  if (payload.scheduledGrayPercent !== undefined) {
    fd.append('scheduledGrayPercent', String(payload.scheduledGrayPercent));
  }
  return request.upload<AppVersion>('/app-updates/versions', fd, {
    timeout: 0,
    dedupe: false,
    onUploadProgress,
  });
}

export function updateVersion(
  id: number,
  payload: {
    versionName?: string;
    updateLog?: string;
    remark?: string;
    scheduledPublishAt?: number | null;
    scheduledPublishMode?: 'full' | 'gray';
    scheduledGrayPercent?: number;
  },
) {
  return request.patch<AppVersion>(`/app-updates/versions/${id}`, payload);
}

export function publishVersion(
  id: number,
  payload: {
    mode: 'full' | 'gray';
    grayPercent?: number;
    grayAutoIncrement?: boolean;
    grayIncrementSchedule?: GrayIncrementStep[];
  },
) {
  return request.post<AppVersion>(
    `/app-updates/versions/${id}/publish`,
    payload,
  );
}

/** 远程强更开关（逃生口）：PUT 语义 */
export function setForceUpdate(
  id: number,
  payload: { forceUpdate: boolean; minVersionCode?: number },
) {
  return request.put<AppVersion>(`/app-updates/versions/${id}/force`, payload);
}

export function offlineVersion(id: number) {
  return request.post<AppVersion>(`/app-updates/versions/${id}/offline`);
}

export function rollbackVersion(id: number) {
  return request.post<RollbackResult>(`/app-updates/versions/${id}/rollback`);
}

export function removeVersion(id: number) {
  return request.delete<{ success: true }>(`/app-updates/versions/${id}`);
}

/** 升级漏斗统计（按版本聚合各事件转化率） */
export function getFunnelStats(params: {
  appKey: string;
  startTime?: number;
  endTime?: number;
}) {
  return request.get<FunnelStatsResult>(
    '/app-updates/versions/stats/funnel',
    params,
  );
}
