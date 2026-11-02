import { http, getApiBaseUrl } from '@/utils/http';
import type { ResourceRoot } from '@vakao/shared';

/** 资源根目录列表（GET /static/roots） */
export function listRoots() {
  return http.get<ResourceRoot[]>('/roots');
}

/** 把后端下发的相对 API 路径转成浏览器可访问的绝对地址（用于复制直链） */
export function absoluteUrl(pathname: string): string {
  const base = getApiBaseUrl();
  return `${window.location.origin}${base}${pathname}`;
}
