import { http } from '@/utils/http';
import type { ResourceRoot } from '@vakao/shared';

/** 资源根目录列表（GET /static/roots） */
export function listRoots() {
  return http.get<ResourceRoot[]>('/roots');
}

/** 新增根目录（POST /static/roots） */
export function createRoot(root: { id: string; name: string; path: string }) {
  return http.post<ResourceRoot[]>('/roots', root);
}

/** 更新根目录（PATCH /static/roots/:id） */
export function updateRoot(id: string, root: { name?: string; path?: string }) {
  return http.patch<ResourceRoot[]>(`/roots/${encodeURIComponent(id)}`, root);
}

/** 删除根目录（DELETE /static/roots/:id） */
export function deleteRoot(id: string) {
  return http.delete<{ success: boolean }>(`/roots/${encodeURIComponent(id)}`);
}
