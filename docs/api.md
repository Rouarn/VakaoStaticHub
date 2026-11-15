# API 概览

[← 返回索引](../README.md)

- 基础路径 `/v1`；所有 JSON 响应统一为 `{"code":200,"message":"ok","data":...}`，列表分页结构位于 `data` 内：`{"items":[],"total":n,"page":p,"pageSize":s}`
- 错误使用同一外层信封：`code` 为 HTTP 状态码、`message` 为错误说明、`data` 为 `null`
- 文件流、图片、安装包下载、占位图与 SPA 静态资源直接返回原始字节，不使用信封；其错误仍为 JSON 信封
- 鉴权使用 `Authorization: Bearer <token>`，由 `POST /v1/auth/login` 签发
- 时间为 RFC 3339；数据库内部使用 Unix 毫秒
- 文件内容端点公开（面板直接使用 `<img>`），分享链接由签名或访问令牌保护（见 [缓存机制](./cache.md)）
- 完整路由表以 [contract.go](../packages/server/internal/httpapi/contract.go) 为准，不提供 Swagger

| 分组         | 主要路径                                                        |
| ------------ | --------------------------------------------------------------- |
| 认证         | `/auth/login`、`/auth/me`、`/auth/logout`、`/auth/password`     |
| 用户         | `/users`、`/users/{id}`                                         |
| 资源根目录   | `/roots`、`/roots/browse`、`/roots/browse/bounds`               |
| 文件         | `/files`、`/files/categories`、`/files/stats`、`/files/duplicates` |
| 文件内容     | `/i/{fileId}`（公开，按 id 取原图 / 缩略图 / 下载）             |
| 上传         | `/files/upload`、`/uploads`、`/uploads/{id}/chunks/{index}`     |
| 分享（管理） | `/shares`、`/shares/{token}`、`/shares/{token}/access-logs`     |
| 分享（公开） | `/s/{token}`、`/s/{token}/unlock`、`/s/{token}/f`、`/s/{token}/f/{index}` |
| APP（管理）  | `/apps`、`/apps/{appKey}/versions`、`/app-versions/{id}/*`      |
| APP（客户端）| `/a/{appKey}/update`、`/a/versions/{id}/download`               |
| 可观测性     | `/audit-logs`、`/metrics`、`/metrics/sidebar`                   |
| 杂项公开     | `/hitokoto`、`/i/photo`、`/i/placeholder`                       |
