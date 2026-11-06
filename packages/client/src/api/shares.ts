import { RequestError } from '@vakao-ui/axios';
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

/** 分享 token：新服务端为 16 字节 base64url，旧库导入的仍可能是 32 位 hex */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

interface ServerShareLink {
  id: number;
  token: string;
  rootId: string;
  category: string;
  filePaths: string[];
  remark?: string;
  enabled: boolean;
  expiresAt?: string;
  maxAccesses?: number;
  password: boolean;
  accessCount: number;
  status: string;
  createdAt: string;
}

interface ServerShareInfo {
  token: string;
  remark?: string;
  rootId: string;
  category: string;
  filePaths: string[];
  hasPassword: boolean;
  expiresAt?: string;
  maxAccesses?: number;
  accessCount: number;
  enabled: boolean;
}

interface ServerPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function toShareLink(link: ServerShareLink): ShareLink {
  const filePaths = link.filePaths ?? [];
  return {
    id: link.id,
    token: link.token,
    rootId: link.rootId,
    category: link.category,
    shareType: filePaths.length > 1 ? 'collection' : 'file',
    filePaths,
    remark: link.remark ? link.remark : null,
    enabled: link.enabled,
    expiresAt: link.expiresAt ? new Date(link.expiresAt).getTime() : null,
    maxAccesses: link.maxAccesses ?? null,
    accessCount: link.accessCount,
    createdAt: new Date(link.createdAt).getTime(),
    hasPassword: link.password,
  };
}

function toShareInfo(info: ServerShareInfo): ShareInfo {
  const filePaths = info.filePaths ?? [];
  return {
    token: info.token,
    rootId: info.rootId,
    category: info.category,
    shareType: filePaths.length > 1 ? 'collection' : 'file',
    filePaths,
    expiresAt: info.expiresAt ? new Date(info.expiresAt).getTime() : null,
    maxAccesses: info.maxAccesses ?? null,
    hasPassword: info.hasPassword,
  };
}

/**
 * 分享页的不可用原因用机器码表达；这里把机器码翻译成界面文案，
 * 页面本身不需要感知新的错误结构。
 */
const SHARE_ERROR_MESSAGES: Record<string, string> = {
  share_not_found: '分享链接不存在',
  share_disabled: '分享链接已停用',
  share_expired: '分享链接已过期',
  share_exhausted: '分享链接次数已达上限',
};

function translateShareError(error: unknown): never {
  if (error instanceof RequestError && error.response) {
    const body = error.response.data as
      { error?: { code?: string } } | undefined;
    const code = body?.error?.code;
    const message = code ? SHARE_ERROR_MESSAGES[code] : undefined;
    if (message) {
      (error.response as { data: unknown }).data = {
        error: { code, message },
        message,
      };
    }
  }
  throw error;
}

/** 分享链接列表：服务端分页 / 关键字 / 状态筛选 */
export async function listShares(query: ShareListQuery = {}) {
  const page = await http.get<
    ServerPage<ServerShareLink> & {
      counts: ShareListResult['counts'];
    }
  >('/shares', {
    ...(query.page ? { page: query.page } : {}),
    ...(query.pageSize ? { pageSize: query.pageSize } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
  });
  return {
    items: page.items.map(toShareLink),
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
    counts: page.counts,
  } satisfies ShareListResult;
}

/** 编辑分享链接：备注 / 有效期 / 密码 / 次数上限 / 启停 */
export async function updateShare(token: string, body: UpdateShareLinkParams) {
  const payload: Record<string, unknown> = {};
  if (body.remark !== undefined) payload.remark = body.remark ?? '';
  if (body.enabled !== undefined) payload.enabled = body.enabled;
  if (body.expiresAt !== undefined) {
    payload.expiresAt =
      body.expiresAt === null ? '' : new Date(body.expiresAt).toISOString();
  }
  if (body.maxAccesses !== undefined) {
    payload.maxAccesses = body.maxAccesses === null ? 0 : body.maxAccesses;
  }
  if (body.password !== undefined) {
    payload.password = body.password === null ? '' : body.password;
  }
  const updated = await http.patch<ServerShareLink>(
    `/shares/${encodeURIComponent(token)}`,
    payload,
  );
  return toShareLink(updated);
}

export async function createShare(body: CreateShareLinkParams) {
  const payload = {
    rootId: body.rootId,
    category: body.category,
    filePaths: body.filePaths,
    remark: body.remark ?? '',
    ...(body.expiresInMs
      ? { expiresAt: new Date(Date.now() + body.expiresInMs).toISOString() }
      : {}),
    ...(body.maxAccesses ? { maxAccesses: body.maxAccesses } : {}),
    ...(body.password ? { password: body.password } : {}),
  };
  const created = await http.post<ServerShareLink>('/shares', payload);
  return toShareLink(created);
}

/** 撤销分享链接：物理删除记录与访问记录，不可恢复（停用请用 updateShare） */
export async function revokeShare(token: string) {
  await http.delete(`/shares/${encodeURIComponent(token)}`);
  return { success: true };
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

export async function listShareAccessLogs(token: string) {
  const page = await http.get<
    ServerPage<{
      id: number;
      ip: string;
      userAgent: string;
      success: boolean;
      createdAt: string;
    }>
  >(`/shares/${encodeURIComponent(token)}/access-logs`);
  return page.items.map(
    (item) =>
      ({
        id: item.id,
        shareToken: token,
        ip: item.ip || null,
        userAgent: item.userAgent || null,
        accessedAt: new Date(item.createdAt).getTime(),
      }) satisfies ShareAccessLog,
  );
}

export async function getShareInfo(token: string) {
  try {
    const info = await publicHttp.get<ServerShareInfo>(
      `/s/${encodeURIComponent(token)}`,
    );
    return toShareInfo(info);
  } catch (error) {
    translateShareError(error);
  }
}

export async function unlockShare(token: string, password?: string) {
  try {
    const result = await publicHttp.post<{ token: string; expiresAt: string }>(
      `/s/${encodeURIComponent(token)}/unlock`,
      password ? { password } : {},
    );
    return { success: true as const, accessToken: result.token };
  } catch (error) {
    translateShareError(error);
  }
}

export type { ShareCollectionFile, ShareCollectionResult };

export async function fetchShareCollection(token: string, accessToken: string) {
  try {
    const result = await publicHttp.get<{
      share: ServerShareInfo;
      files: Array<{
        index: number;
        name: string;
        path: string;
        size: number;
        exists: boolean;
      }>;
    }>(`/s/${encodeURIComponent(token)}/f`, { accessToken });
    return {
      shareType: 'collection',
      rootId: result.share.rootId,
      category: result.share.category,
      files: result.files.map(
        (file) =>
          ({
            path: file.path,
            name: file.name,
            size: file.exists ? file.size : null,
            exists: file.exists,
          }) satisfies ShareCollectionFile,
      ),
    } satisfies ShareCollectionResult;
  } catch (error) {
    translateShareError(error);
  }
}

/** 分享访问页地址（前端路由，统一由 utils/file-url.ts 构造） */
export const getSharePageUrl = buildSharePageUrl;
