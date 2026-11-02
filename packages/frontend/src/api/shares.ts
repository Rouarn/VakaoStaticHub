import type {
  CreateShareLinkParams,
  ShareAccessLog,
  ShareCollectionFile,
  ShareCollectionResult,
  ShareInfo,
  ShareLink,
  ShareListQuery,
  ShareListResult,
  UpdateShareLinkParams,
} from '@vakao/shared';
import { http, publicHttp } from '@/utils/http';
import { buildSharePageUrl, buildShareFileUrl } from '@/utils/file-url';

export { buildSharePageUrl, buildShareFileUrl };

/** 分享 token 为 32 位小写 hex（后端 randomBytes(16).toString('hex')） */
export const SHARE_TOKEN_RE = /^[0-9a-f]{32}$/;

/** 分享链接列表：服务端分页 / 关键字 / 状态筛选 */
export function listShares(query: ShareListQuery = {}) {
  return http.get<ShareListResult>('/share/list', {
    ...(query.page ? { page: query.page } : {}),
    ...(query.pageSize ? { pageSize: query.pageSize } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
  });
}

/** 编辑分享链接：备注 / 有效期 / 密码 / 次数上限 / 启停 */
export function updateShare(token: string, body: UpdateShareLinkParams) {
  return http.patch<ShareLink>(`/share/${encodeURIComponent(token)}`, body);
}

export function createShare(body: CreateShareLinkParams) {
  return http.post<ShareLink>('/share', body);
}

/** 撤销分享链接：物理删除记录与访问记录，不可恢复（停用请用 updateShare） */
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

export type { ShareCollectionFile, ShareCollectionResult };

export function fetchShareCollection(token: string, accessToken: string) {
  return publicHttp.get<ShareCollectionResult>(
    `/share/${encodeURIComponent(token)}`,
    { accessToken },
  );
}

/** 分享访问页地址（前端路由，统一由 utils/file-url.ts 构造） */
export const getSharePageUrl = buildSharePageUrl;
