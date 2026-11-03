import type {
  CreateShareLinkParams,
  ShareAccessLog,
  ShareBatchAction,
  ShareBatchItemResult,
  ShareBatchResult,
  ShareCollectionFile,
  ShareCollectionResult,
  ShareInfo,
  ShareLink,
  ShareListQuery,
  ShareListResult,
  UpdateShareLinkParams,
} from '@vakao/shared';
import { getErrorMessage, http, publicHttp } from '@/utils/http';
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

/** 批量操作并发上限：单页最多 64 条，4 并发兼顾速度与后端压力 */
const BATCH_CONCURRENCY = 4;

/** 限并发遍历，保证结果顺序与入参一致（失败不中断后续任务） */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await task(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return output;
}

/**
 * 批量启用 / 停用 / 删除分享链接。
 *
 * 采用「前端限并发复用单条接口」而非新增批量接口：
 * - 单页选中量有限（最多 64），逐个请求不会造成压力，且无需新增 DTO/上限校验
 * - 每条请求独立成败，网络中断或个别链接已被删除时仍能给出精确的成功/失败明细
 * - 单条接口已有审计日志，批量操作自然逐条留痕
 *
 * 单条失败不会 reject，统一折叠进 ShareBatchResult，由调用方如实展示。
 */
export async function batchShareAction(
  tokens: readonly string[],
  action: ShareBatchAction,
): Promise<ShareBatchResult> {
  const fallback = action === 'delete' ? '删除失败' : '操作失败';
  const results = await mapWithConcurrency(
    tokens,
    BATCH_CONCURRENCY,
    async (token): Promise<ShareBatchItemResult> => {
      try {
        if (action === 'delete') await revokeShare(token);
        else await updateShare(token, { enabled: action === 'enable' });
        return { token, success: true };
      } catch (e) {
        return { token, success: false, error: getErrorMessage(e, fallback) };
      }
    },
  );
  const failed = results.filter((item) => !item.success).length;
  return {
    action,
    total: tokens.length,
    succeeded: tokens.length - failed,
    failed,
    results,
  };
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
