/**
 * 前后端共享的 API 通用类型。
 *
 * 后端 ResponseInterceptor 会把所有响应包装成 ApiResponse；
 * 前端 request 工具会解包 data 字段并返回给业务调用方。
 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

/** 服务端统一的分页结果；页码从 1 开始 */
export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
