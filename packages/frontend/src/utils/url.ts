import { getApiBaseUrl } from '@/utils/env';

export const buildFileUrl = (
  rootId: string,
  category: string,
  path: string,
) => {
  const base = (getApiBaseUrl() || window.location.origin).replace(/\/$/, '');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/files/${rootId}/${encodeURIComponent(category)}/${encodedPath}`;
};
