# 缓存机制

[← 返回索引](../README.md)

项目里有三类缓存，回收方式各不相同：缩略图缓存由服务自己清理，Office 转换缓存交给系统回收，分享文件缓存交给 CDN。

## 缩略图缓存

- 位置：`CACHE_DIR`（默认 `<BASE_DIR>/data/.cache`）
- 生成：首次请求缩略图时按需生成，之后直接命中磁盘
- 回收：服务内建两套规则，任一触发即清理——按时间 `THUMB_CACHE_RETENTION_DAYS`（默认 30 天）、按总量 `THUMB_CACHE_MAX_MB`（默认 512MB）；每天在 `CLEANUP_AT`（默认 `03:00`）执行一次
- 代价：被清掉的缩略图会在下次请求时重新生成

## Office 转换缓存

- 位置：`OFFICE_CACHE_DIR`，默认是系统临时目录下的 `vakao-static-hub-office`（Linux 即 `/tmp/vakao-static-hub-office`）
- 内容：LibreOffice 转出的 PDF，按「转换器版本 + 源文件 + 大小 + 修改时间」命名，源文件一变键就变，不会命中旧缓存
- 回收：完全交给系统（重启、tmpfiles、手动清理都可能整目录删掉）。**它不属于站点数据**，随时可能消失
- 代价：只影响下一次预览，重新转换一次即可；进程启动时会自动重建目录与 LibreOffice 用户配置，不需要预置
- 因此这里**没有**保留天数、容量上限和独立的清理任务——刻意只保留系统这一套回收机制

## 分享文件缓存

分享的文件地址是稳定签名（`/v1/s/<token>/f/<index>?sig=…`），同一版本的同一文件永远是同一个地址，CDN 可以长期复用。为此：

- 分享文件响应头：`public, max-age=604800`（7 天，**不带** `immutable`），给撤销留出兜底窗口
- 其余资源（`/v1/i`、缩略图、转换 PDF）：`public, max-age=31536000, immutable`，因为它们的地址随内容变化

### 撤销分享时的 CDN 刷新

删除或停用分享时，服务端会按目录前缀刷新 EdgeOne 缓存，`/v1/s/<token>/f/` 一次覆盖该分享的全部文件与变体，不逐条刷：

- 需要 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`EDGEONE_ZONE_ID` 三项齐全；任一留空则完全不外呼
- 刷新失败只写日志、不重试，**不影响删除/停用本身**；此时靠 7 天 TTL 自然过期兜底
- 一次撤销消耗 1 条前缀刷新（实际计量以 EdgeOne 控制台为准）
- 密钥对应的子账号需要站点级别的 `teo:CreatePurgeTask` 权限，否则日志会出现 `AuthFailure.UnauthorizedOperation`

### 部署时必须同步的一步

宝塔的反向代理默认在 nginx 上也开一层 `proxy_cache`。如果不同步关掉它对 `/v1/` 的缓存，CDN 刷新回源时会立刻拿到 nginx 缓存的旧 `200`，刷新等于失效。配置片段与验证方法见 [部署 - Nginx 反向代理](./deployment.md#nginx-反向代理v1-必须绕过-proxy_cache)。

## 密码分享为什么缓存命中差

带密码的分享不能用「可自由转发的稳定签名」，否则拿到文件地址就等于绕过密码。因此密码分享服务端不下发签名，客户端只能用解锁后 30 分钟有效的会话令牌访问——地址每次不同、CDN 基本无法复用。这是安全优先的主动取舍。
