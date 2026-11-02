import type {
  CreateShareLinkParams,
  ShareAccessLog,
  ShareInfo,
  ShareLink,
} from '@vakao/shared';
import { getApiBaseUrl, http, publicHttp } from '@/utils/http';

/** 分享 token 为 32 位小写 hex（后端 randomBytes(16).toString('hex')） */
export const SHARE_TOKEN_RE = /^[0-9a-f]{32}$/;

export function listShares() {
  return http.get<ShareLink[]>('/share/list');
}

export function createShare(body: CreateShareLinkParams) {
  return http.post<ShareLink>('/share', body);
}

/** 撤销分享链接（后端无「停用」状态，撤销即删除记录，不可恢复） */
export function revokeShare(token: string) {
  return http.delete<{ success: boolean }>(
    `/share/${encodeURIComponent(token)}`,
  );
}

export function listShareAccessLogs(token: string) {
  return http.get<ShareAccessLog[]>(
    `/share/${encodeURIComponent(token)}/access-logs`,
  );
}

export function getShareInfo(token: string) {
  return publicHttp.get<ShareInfo>(`/share/${encodeURIComponent(token)}/info`);
}

export function unlockShare(token: string, password?: string) {
  return publicHttp.post<{ success: true; accessToken: string }>(
    `/share/${encodeURIComponent(token)}/verify`,
    password ? { password } : {},
  );
}

export interface ShareCollection {
  shareType: 'collection';
  category: string;
  files: string[];
}

export function fetchShareCollection(token: string, accessToken: string) {
  return publicHttp.get<ShareCollection>(
    `/share/${encodeURIComponent(token)}`,
    { accessToken },
  );
}

/** 分享访问页地址（前端路由，不是后端接口） */
export function getSharePageUrl(token: string) {
  return `${window.location.origin}/share/${token}`;
}

/** 分享内文件访问地址：打开后凭 accessToken 访问，不再消耗打开次数 */
export function buildShareFileUrl(
  token: string,
  accessToken: string,
  opts: { index?: number; download?: boolean } = {},
) {
  const query: string[] = [`accessToken=${encodeURIComponent(accessToken)}`];
  if (opts.index !== undefined) query.push(`index=${opts.index}`);
  if (opts.download) query.push('download=1');
  return `${getApiBaseUrl()}/share/${encodeURIComponent(token)}?${query.join('&')}`;
}
