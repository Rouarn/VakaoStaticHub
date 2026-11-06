import { http } from '@/utils/http';
import type {
  BrowseBoundsResult,
  BrowseDirectoriesResult,
  ResourceRoot,
} from '@vakao/shared';

interface ServerRoot {
  id: string;
  name: string;
  path: string;
  description?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

function toRoot(root: ServerRoot): ResourceRoot {
  return { id: root.id, name: root.name, path: root.path };
}

/** 资源根目录列表（GET /api/v1/roots） */
export async function listRoots() {
  const roots = await http.get<ServerRoot[]>('/roots');
  return roots.map(toRoot);
}

/**
 * 允许浏览与创建根目录的边界（GET /api/v1/roots/browse/bounds）
 *
 * 返回主目录、已配置根目录的父级与白名单，供目录选择弹框展示快捷入口。
 */
export function browseBounds() {
  return http.get<BrowseBoundsResult>('/roots/browse/bounds');
}

/**
 * 浏览服务器目录（GET /api/v1/roots/browse）
 *
 * 省略 path 时从后端运行用户的主目录开始；返回仅包含目录，
 * 超出安全边界返回 403，无权限返回 400。
 */
export function browseDirectories(path?: string) {
  return http.get<BrowseDirectoriesResult>(
    '/roots/browse',
    path ? { path } : undefined,
  );
}

/** 新增根目录（POST /api/v1/roots） */
export async function createRoot(root: {
  id: string;
  name: string;
  path: string;
}) {
  const created = await http.post<ServerRoot>('/roots', root);
  return [toRoot(created)] as ResourceRoot[];
}

/** 更新根目录（PATCH /api/v1/roots/:id） */
export async function updateRoot(
  id: string,
  root: { name?: string; path?: string },
) {
  const updated = await http.patch<ServerRoot>(
    `/roots/${encodeURIComponent(id)}`,
    root,
  );
  return [toRoot(updated)] as ResourceRoot[];
}

/** 删除根目录（DELETE /api/v1/roots/:id） */
export async function deleteRoot(id: string) {
  await http.delete(`/roots/${encodeURIComponent(id)}`);
  return { success: true };
}
