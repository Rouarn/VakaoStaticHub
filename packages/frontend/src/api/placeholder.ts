import { getApiBaseUrl } from '@/utils/file-url';

export interface PlaceholderParams {
  width: number;
  height: number;
  text: string;
  bgColor: string;
  textColor: string;
  fontFamily: string;
  fontWeight: string;
  fontSize?: number;
}

export type PlaceholderStyleParams = Omit<
  PlaceholderParams,
  'width' | 'height'
>;

function styleQuery(params: PlaceholderStyleParams) {
  const query = new URLSearchParams();
  if (params.text) query.set('text', params.text);
  if (params.bgColor) query.set('bgColor', params.bgColor);
  if (params.textColor) query.set('textColor', params.textColor);
  if (params.fontFamily) query.set('fontFamily', params.fontFamily);
  if (params.fontWeight) query.set('fontWeight', params.fontWeight);
  if (params.fontSize) query.set('fontSize', String(params.fontSize));
  return query.toString();
}

/**
 * 占位图接口地址：GET /placeholder/:width/:height
 * 后端只输出 SVG；PNG/JPEG 由前端栅格化后下载。
 */
export function buildPlaceholderUrl(params: PlaceholderParams) {
  const qs = styleQuery(params);
  const base = `${getApiBaseUrl()}/placeholder/${Math.round(params.width)}/${Math.round(params.height)}`;
  return qs ? `${base}?${qs}` : base;
}

/** 默认（/placeholder）与方形（/placeholder/:size）两种快捷接口 */
export function buildPlaceholderPresetUrl(
  kind: 'default' | 'square',
  size: number,
  params: PlaceholderStyleParams,
) {
  const base =
    kind === 'default'
      ? `${getApiBaseUrl()}/placeholder`
      : `${getApiBaseUrl()}/placeholder/${Math.round(size)}`;
  const qs = styleQuery(params);
  return qs ? `${base}?${qs}` : base;
}
