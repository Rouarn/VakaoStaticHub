# 后端彻底重构方案（packages/backend）

> 分支：`refactor/backend`（从 `main` @ `3459b3a` 切出）
>
> 本文是执行前置方案。**对外契约冻结**：路由、方法、入参字段与类型、`{code,message,data}` 信封、
> 错误码与提示语义、分页参数、静态文件 URL、JWT Bearer 鉴权方式全部保持不变。
> 验收标准：前端零改动即可跑通全部功能；重构前后 API 响应形状逐条比对无未解释差异。

---

## 0. 硬约束与验收口径

| 约束 | 说明 |
| --- | --- |
| 不修补 | 不沿用旧文件的临时补丁式结构；按本方案的目录与分层重写文件树，旧实现只作功能对照 |
| 不遗漏 | 现有全部对外能力（含校验、定时任务、审计写入点、限流、Range/断点续传）一条不少 |
| 不乱套 | 命名、分层、错误处理、配置来源、日志级别统一 |
| 契约冻结 | 见上；发现契约缺陷只写入第 9 章「建议」，本次不改 |
| 技术栈 | NestJS 12、TypeScript 6、TypeORM 1 + sql.js（`location` + `autoSave`）、class-validator/class-transformer、`@nestjs/jwt` + passport-jwt、multer、`@nestjs/schedule`、Helmet、`@nestjs/throttler`、sharp |
| 数据库 | 无迁移文件、无版本化升级；开发由 `DB_SYNCHRONIZE` 决定启动同步；线上只认 `pnpm db:sync`；同步+播种唯一实现 `ensure-schema.ts` |

当前版本事实（重构前实测）：

- 全局前缀 `/static`；Swagger 挂载在 `/docs`（`docs-json` = `/docs-json`）。**Swagger 文档中的路径会出现 `/static/static/...` 的前缀重复，这是现网行为，本次保持不动**（见第 9 章建议）。
- API 操作总数 **73**（Swagger paths × methods 计数，含 hitokoto 代理通配的 8 个方法；不含 SPA 静态托管与 `/docs` 页面）。
- 数据库 7 张业务表：`file_entries`、`share_links`、`share_access_logs`、`app_versions`、`app_upgrade_events`、`users`、`audit_logs`。
- 定时/周期任务 4 类：分片临时目录+缩略图+过期分享清理（每日 03:00）、灰度自动递增（每小时）、定时发布扫描（每 10 分钟）、Token 黑名单清理（每 10 分钟，`setInterval`）。

---

## 1. 能力清单对照表

「现有实现位置」以重构前文件为准；「新归属」为本方案落地后的模块。验收方式统一包含：
`API 快照比对`（重构前基线 JSON 形状）、`CDP 前端走查`（零改动）、`单测/脚本断言`（并发、DB 路径）。

### 1.1 认证与用户（8 端点）

| # | 能力 | 现有实现位置 | 新归属 | 保留 | 验收方式 |
| --- | --- | --- | --- | --- | --- |
| 1 | 登录（5 次/分钟限流，返回 accessToken/tokenType/expiresIn/user） | `modules/auth/auth.controller.ts` `login`、`auth.service.ts` | `modules/auth` | 是 | API 快照 + 第 6 次 429 + CDP 登录 |
| 2 | 登出（内存 Token 黑名单吊销，10 分钟清理） | `auth.controller.ts` `logout`、`token-blacklist.service.ts` | `modules/auth`（`token-blacklist.service.ts`） | 是 | 登出后旧 token 401「Token 已失效」 |
| 3 | 当前用户信息 `/auth/profile` | `auth.controller.ts` / `auth.service.findAuthInfo` | `modules/auth` | 是 | API 快照 + CDP 侧栏用户名 |
| 4 | 改密（校验旧密码；改密后旧 token 因 iat < updatedAt 失效） | `auth.service.changePassword`、`jwt.strategy.ts` | `modules/auth` | 是 | 改密后旧 token 401；新密码可登录 |
| 5 | 用户列表（按 createdAt 升序，无密码哈希） | `auth.service.listUsers` | `modules/auth` | 是 | API 快照 |
| 6 | 注册（需登录；`role` 仅管理员可建管理员；重名 409） | `auth.controller.register`、`auth.service.register` | `modules/auth` | 是 | 401/403/409 负例 + 成功 |
| 7 | 管理员重置他人密码（不能重置自己；目标不存在 404；非管理员 403） | `auth.service.resetPassword` | `modules/auth` | 是 | 三类负例 + 成功 |
| 8 | 删除用户（不能删自己；至少保留一个管理员） | `auth.service.deleteUser` | `modules/auth` | 是 | 负例 + 成功 |

JWT 语义（必须保留）：

- 提取顺序：`Authorization: Bearer` → `?token=` → `?auth=Bearer%20...`。
- `ignoreExpiration: false`；用户不存在 → 401；`payload.iat < user.updatedAt/1000` → 401「密码已修改，请重新登录」。
- 登出 token 进入进程内黑名单（非持久化、单实例语义）。

### 1.2 文件与根目录（文件管理 19 端点 + 资源根 5 端点）

| # | 能力 | 现有实现位置 | 新归属 | 保留 | 验收方式 |
| --- | --- | --- | --- | --- | --- |
| 9 | 文件配置 `/files/config`（默认分类、图片扩展名、上传上限等） | `files.controller` `getFileConfig`、`files.service` | `modules/files` | 是 | API 快照 |
| 10 | 存储用量统计 `/files/stats/usage`（按根/分类聚合） | `files.service.getUsageStats` | `modules/files`（`usage.service`） | 是 | API 快照 + CDP 存储统计页 |
| 11 | 重复文件扫描 `/files/duplicates`（SHA-256 分组、可惰性补算、分页） | `files.service.getDuplicateFiles` | `modules/files`（`duplicate.service`） | 是 | API 快照 + CDP 重复文件页 |
| 12 | 分类列表 `/files/:rootId/categories` | `files.service.listCategories` | `modules/files` | 是 | API 快照 + CDP |
| 13 | 新建分类（校验 basename、禁 `.` 开头、默认分类保留、重名 409） | `files.service.createCategory` | `modules/files` | 是 | 负例 400/409 + 成功 |
| 14 | 删除分类（默认需为空；`recursive=true` 连文件删；默认分类禁删） | `files.service.deleteCategory` | `modules/files` | 是 | 负例 + 成功 |
| 15 | 重命名分类（目录改名 + 索引/分享迁移） | `files.service.renameCategory` | `modules/files` | 是 | 成功 + 索引/分享同步 |
| 16 | 文件列表（分页 page≥1/pageSize≤500 默认 100、`q` 搜索、`sort=name/size/mtime`、`order`） | `files.service.listFilesPaged` | `modules/files` | 是 | API 快照 + CDP 翻页/搜索/排序 |
| 17 | 强制重建索引 `/files/sync` | `file-index.service.syncAll` | `modules/files`（`file-index.service`） | 是 | 调用后列表变化 |
| 18 | 单文件元信息（HEAD/GET 直出，见 19） | `files.controller.serveFile` | `modules/files` | 是 | Range/304/416 断言 |
| 19 | 单文件上传（multipart `files[]` + `category`，批量） | `files.controller.uploadFiles`、`files.service.batchSaveFiles` | `modules/files`（`upload.service`） | 是 | CDP 上传 + API 快照 |
| 20 | 重命名文件（同名 409、目标非文件 400） | `files.service.renameFile` | `modules/files` | 是 | 负例 + 成功 |
| 21 | 删除文件 | `files.service.deleteFile` | `modules/files` | 是 | 成功 |
| 22 | 批量删除 | `files.service.batchDeleteFiles` | `modules/files` | 是 | CDP 批量 + 快照 |
| 23 | 批量移动（目标分类须存在、同分类 400） | `files.service.batchMoveFiles` | `modules/files` | 是 | CDP 批量移动 |
| 24 | 复制文件（同分类内复制、重名冲突处理） | `files.service.copyFile`（现有能力，前端调用） | `modules/files` | 是 | 成功 + 冲突负例 |
| 25 | 静态文件直出（Range 206/416、弱 ETag 304、Content-Type、inline/attachment） | `utils/file-serve.util.ts` + `serveFile` | `infra/storage`（`file-serve.util.ts`） | 是 | curl 断言 200/206/304/416 |
| 26 | 图片实时处理（`w/h/q/format`，sharp，缓存 86400） | `image-processor.service.ts` | `modules/files`（`image-processor.service`） | 是 | 返回 webp + 尺寸断言 |
| 27 | 分片 init（uploadId=md5(userId:rootId:category:filename:size)，断点续传 `uploadedChunks`） | `files.service.initChunkUpload` | `modules/files`（`upload.service`） | 是 | 续传脚本断言 |
| 28 | 分片 chunk（`uploadId`+`index`，100MB 硬上限，取消竞态保护） | `files.service.saveChunk` | `modules/files` | 是 | 取消/续传并发 |
| 29 | 分片 complete（尺寸校验、写入磁盘、upsert 索引） | `files.service.completeChunkUpload` | `modules/files` | 是 | 尺寸不匹配 400 + 成功 |
| 30 | 分片 cancel（清理临时目录，5 分钟取消标记） | `files.service.cancelChunkUpload` | `modules/files` | 是 | 取消后目录不存在 |
| 31 | 根目录列表/新增/删除/改名 | `modules/roots/roots.controller.ts`、`resource-roots.service.ts` | `infra/resource-roots` + `modules/roots` | 是 | CDP 目录管理 + API 快照 |
| 32 | 系统目录浏览 `/roots/system/directories`（Windows 盘符/绝对路径） | `roots.controller.browseDirectories` | `modules/roots` | 是 | API 快照 |
| 33 | 根目录路径安全（`..` 拒绝、`normalize`、根内白名单、`roots` 保留 ID） | `files/utils/path-utils.ts`、`roots.controller` | `common/utils/path.util.ts` | 是 | 穿越负例 400 |

### 1.3 分享（8 端点）

| # | 能力 | 现有实现位置 | 新归属 | 保留 | 验收方式 |
| --- | --- | --- | --- | --- | --- |
| 34 | 创建分享（`rootId/category/filePaths[]`，单字段 `filePaths`，1~200 个，路径合法性校验） | `share.service.createShareLink` | `modules/share` | 是 | CDP 单文件/批量 + 快照 |
| 35 | `shareType` 派生（长度 1=file，>1=collection，不落库） | `share.service` mapper | `modules/share`（`share.mapper.ts`） | 是 | 快照字段一致 |
| 36 | 列表（分页 page/pageSize≤100 默认 10、`q`、`status=active/expired/exhausted/disabled`） | `share.service.listShareLinks` | `modules/share` | 是 | CDP 筛选 + 快照 |
| 37 | 编辑（备注/绝对过期/密码/次数/启停，`null` 清空语义） | `share.service.updateShareLink` | `modules/share` | 是 | CDP 编辑 + null 语义 |
| 38 | 撤销 | `share.service.revokeShareLink` | `modules/share` | 是 | CDP |
| 39 | 公开 info（停用 410 Gone、过期/次数上限 400） | `share.service.getShareInfo` | `modules/share` | 是 | 负例状态码 |
| 40 | 公开 verify（密码门：未带密码 401「需要访问密码」、错误 401；10 次/分钟；成功记访问日志+accessCount） | `share.service.unlock` | `modules/share` | 是 | CDP 密码门 + 第 11 次 429 |
| 41 | 公开访问 `/:token`（`index` 指定单项、无 index 时单文件直出/多文件 JSON；`accessToken` 解锁凭证；`download/w/h/q/format`） | `share.controller.accessShareLink` | `modules/share` | 是 | CDP 多文件逐项预览 + 快照 |
| 42 | 访问日志列表（登录） | `share.service.listAccessLogs` | `modules/share` | 是 | CDP 访问记录 |

分享状态语义：`enabled=0` → 410；`expiresAt < now` → 400「已过期」；`accessCount >= maxAccesses` → 400「已达上限」；密码校验通过返回 `accessToken`（现有实现的具体令牌形式保持不变）。

### 1.4 APP 更新与统计（客户端 3 + 管理端 15）

| # | 能力 | 现有实现位置 | 新归属 | 保留 | 验收方式 |
| --- | --- | --- | --- | --- | --- |
| 43 | 客户端检查更新（`platform/appKey/versionCode`，灰度命中、强更、minVersionCode、返回下载 URL/大小/校验和） | `app-update-client.controller`、`app-update.service.checkUpdate` | `modules/app-update` | 是 | 快照 + 灰度脚本 |
| 44 | APK 下载（Range/206/416/304、强 ETag、immutable、`application/vnd.android.package-archive`） | `app-update-client.controller.download`、`serveApkFile` | `modules/app-update` + `infra/storage` | 是 | curl 断言 |
| 45 | 升级事件上报（事件枚举 9 种、deviceId 必填） | `app-update-stats.service.report` | `modules/app-update` | 是 | 快照 + 漏斗 |
| 46 | 应用 CRUD（列表/创建/改名/删除，目录联动） | `app-update-app.controller`、`app-update.service` | `modules/app-update` | 是 | CDP 建应用/改名/删除 |
| 47 | 版本上传（multipart `file`，APK ZIP 校验、`appKey/versionName/versionCode`、checksum） | `app-update-admin.controller.upload`、`apk-upload.interceptor.ts` | `modules/app-update` | 是 | CDP 上传版本 |
| 48 | 版本列表（分页、`status/appKey/platform` 过滤） | `app-update.service.list` | `modules/app-update` | 是 | CDP + 快照 |
| 49 | 版本详情 / 编辑（发布中不可编辑 400；定时发布字段） | `app-update.service.detail/update` | `modules/app-update` | 是 | 负例 + 成功 |
| 50 | 发布（full/gray、灰度百分比 1~99、自动递增表；同应用同平台旧版自动下架 `offlineReason=auto`） | `app-update.service.publish` | `modules/app-update` | 是 | 三路并发仅 1 PUBLISHED |
| 51 | 强更开关 `PUT /:id/force`（forceUpdate、minVersionCode） | `app-update.service.setForce` | `modules/app-update` | 是 | CDP |
| 52 | 手动下架（`offlineReason=manual`） | `app-update.service.offline` | `modules/app-update` | 是 | CDP |
| 53 | 回滚（服务端计算候选、仅 PUBLISHED 或 OFFLINE(auto) 可作候选、PUBLISHED→OFFLINE(manual)） | `app-update.service.rollback` | `modules/app-update` | 是 | CDP + publish/rollback 并发 |
| 54 | 回滚候选列表 | `app-update.service.rollbackCandidates` | `modules/app-update` | 是 | 快照 |
| 55 | 版本删除 | `app-update.service.remove` | `modules/app-update` | 是 | CDP |
| 56 | 定时发布（每小时/每 10 分钟扫描：到点转 PUBLISHED/GRAY） | `app-update.service` `@Cron` | `modules/app-update`（`scheduler`） | 是 | 脚本等待触发断言 |
| 57 | 灰度自动递增（每小时按 schedule 提升 grayPercent，至 100 转 PUBLISHED） | `app-update.service` `@Cron` | `modules/app-update` | 是 | 脚本断言 |
| 58 | 升级漏斗统计（`appKey` 必填、startTime/endTime，事件分阶段计数） | `app-update-stats.service.funnel` | `modules/app-update` | 是 | CDP 漏斗页 |

版本状态：`0=DRAFT`、`1=GRAY`、`2=PUBLISHED`、`3=OFFLINE`；`offlineReason` 三态：`null` / `'auto'`（被新版发布挤下架，可回滚恢复）/ `'manual'`（人工止血，不自动恢复）。

### 1.5 系统与工具（6 + 后台任务）

| # | 能力 | 现有实现位置 | 新归属 | 保留 | 验收方式 |
| --- | --- | --- | --- | --- | --- |
| 59 | `/health`（`{status:'ok'}`） | `app.controller.ts` | `modules/health` | 是 | 快照 |
| 60 | `/metrics`（health + DB 大小 + 存储/分享/版本/24h 升级/QPS） | `metrics.controller`、`metrics.service`、`qps.interceptor` | `modules/metrics` | 是 | CDP 系统状态 + 快照 |
| 61 | 审计日志查询（page/pageSize≤100、action/resourceType/username/startTime/endTime） | `audit-log.controller`、`audit-log.service` | `modules/audit-log` | 是 | CDP + 快照 |
| 62 | 审计写入点（登录/登出/改密/重置/注册/删用户/分类 CRUD/文件上传改名删除批量/分享 CRUD/版本发布下架回滚/应用 CRUD 等） | 各 controller 调用 `AuditLogService.log` | `common/audit`（服务在 `modules/audit-log`，调用点保留） | 是 | 操作后审计页可见 |
| 63 | 占位图 SVG（`/placeholder`、`/:size`、`/:width/:height`，1~4096，颜色补 `#`） | `placeholder.controller/service`、`generators/default.ts` | `modules/placeholder` | 是 | CDP 工具页 + 快照 |
| 64 | 一言代理（`/hitokoto/*` 全方法转发，上游失败 503） | `hitokoto.proxy.middleware.ts` | `modules/hitokoto` | 是 | 快照（503 语义） |
| 65 | 随机图片 `/photo`（按分类随机、宽高参数） | `photo.controller/service` | `modules/photo` | 是 | CDP |
| 66 | Swagger `/docs` + `/docs-json` | `main.ts` | `infra/swagger` | 是 | 页面 200 |
| 67 | SPA 静态托管 + fallback（`cwd/web`，仅 GET、无扩展名、Accept html） | `main.ts` | `infra/bootstrap` | 是 | 直访 `/` 200 |
| 68 | 全局校验：`whitelist + forbidNonWhitelisted + transform` | `main.ts` | `common/http` | 是 | 多余字段 400 |
| 69 | 统一响应信封/异常过滤/请求日志 | `common/response.interceptor.ts`、`http-exception.filter.ts`、`logging.interceptor.ts` | `common/http` | 是 | 快照 + 日志 |
| 70 | 分片孤儿清理（每日 03:00，24h idle，uploadId 正则白名单） | `cleanup.service.ts` | `modules/files`（`cleanup.service`） | 是 | 脚本造孤儿 + 手动触发 |
| 71 | 缩略图缓存清理（源文件不存在即删） | `cleanup.service.ts` + `image-processor` | `modules/files` | 是 | 脚本 |
| 72 | 过期分享清理（expiresAt 已过或次数用尽） | `cleanup.service.ts` | `modules/share`（`cleanup.service`） | 是 | 脚本 |
| 73 | 索引同步（根目录扫描；启动/定时/`/files/sync`） | `file-index.service.ts` | `modules/files` | 是 | 启动日志 + CDP |

---

## 2. 目录结构规划

```
packages/backend/src/
├── main.ts                        # 唯一入口：创建应用、装配基础设施、监听端口
├── app.module.ts                  # 只做模块聚合，不写业务
├── common/                        # 跨模块复用，禁止反向依赖 modules
│   ├── http/
│   │   ├── response.interceptor.ts
│   │   ├── http-exception.filter.ts
│   │   ├── logging.interceptor.ts
│   │   └── validation.ts          # ValidationPipe 工厂（统一 whitelist 配置）
│   ├── dto/
│   │   ├── pagination-query.dto.ts  # page/pageSize，@Min(1)/@Max(100)，默认 1/10
│   │   └── paginated-result.ts      # { items, total, page, pageSize } 类型
│   ├── decorators/current-user.decorator.ts
│   ├── guards/jwt-auth.guard.ts     # JwtAuthGuard + @Public 元数据
│   ├── utils/path.util.ts           # safeJoin / normalizeCategoryPath / getFileExtension / UPLOAD_ID_REGEX
│   ├── utils/request-meta.util.ts   # ip + userAgent
│   ├── utils/size.util.ts           # parseSize
│   └── utils/mime.util.ts           # getMimeType / isPreviewable
├── config/
│   ├── app-config.module.ts         # ConfigModule.forRoot 唯一装配点
│   ├── server.config.ts             # PORT/BODY_LIMIT/STATIC_PREFIX/CORS_ORIGIN/ENABLE_SWAGGER
│   ├── auth.config.ts               # AUTH_USER/AUTH_PASS/JWT_SECRET/JWT_EXPIRES_IN（启动强校验）
│   ├── database.config.ts           # DB_PATH/DB_SYNCHRONIZE
│   ├── file.config.ts               # FILE_ROOT/UPLOAD_MAX_COUNT/DEFAULT_CATEGORY/UPLOAD_TEMP_DIR/CHUNK_FILE_SIZE_LIMIT
│   └── schedule.config.ts           # CACHE_REFRESH_INTERVAL_MS
├── infra/
│   ├── database/
│   │   ├── database.module.ts       # TypeOrmModule.forRootAsync(sqljs)
│   │   ├── database-entities.ts     # 7 实体唯一清单
│   │   ├── database-bootstrap.service.ts  # 开发/生产模式矩阵
│   │   ├── ensure-schema.ts         # 唯一 syncSchema + assertSchemaReady + 旧分享数据规整
│   │   └── entities/*.entity.ts
│   ├── resource-roots/
│   │   ├── resource-roots.module.ts
│   │   └── resource-roots.service.ts # resource-roots.json 读写 + 事件广播
│   ├── storage/
│   │   ├── file-serve.util.ts       # serveStaticFile / serveApkFile / parseHttpRange
│   │   └── storage.module.ts        # 导出存储工具，避免 modules 互相引 utils
│   ├── swagger/swagger.setup.ts
│   └── bootstrap/
│       ├── app-bootstrap.ts         # Helmet/CORS/body limit/全局管道/静态托管/fallback
│       └── spa-fallback.ts
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts       # 只做 HTTP → service
│   │   ├── auth.service.ts
│   │   ├── jwt.strategy.ts
│   │   ├── token-blacklist.service.ts
│   │   ├── guards/jwt-auth.guard.ts  # re-export common guard（保持单实现）
│   │   ├── decorators/public.decorator.ts
│   │   ├── utils/password.util.ts
│   │   └── dto/{login,register,change-password,reset-password}.dto.ts
│   ├── users/                        # 用户查询/删改（从 auth 拆出，维持同路径）
│   │   └── user.service.ts
│   ├── files/
│   │   ├── files.module.ts
│   │   ├── files.controller.ts
│   │   ├── files.service.ts          # 列表/分类/重命名/删除/批量/移动/复制
│   │   ├── upload.service.ts         # 单文件批量 + 分片 4 步
│   │   ├── file-index.service.ts
│   │   ├── duplicate.service.ts
│   │   ├── usage.service.ts
│   │   ├── image-processor.service.ts
│   │   ├── cleanup.service.ts        # 缩略图 + 孤儿分片
│   │   ├── files.mapper.ts
│   │   └── dto/*.dto.ts
│   ├── roots/roots.controller.ts + roots.service.ts + dto
│   ├── share/
│   │   ├── share.module.ts
│   │   ├── share.controller.ts
│   │   ├── share.service.ts
│   │   ├── share-access.service.ts   # 公开 info/verify/单项访问/下载
│   │   ├── share-cleanup.service.ts
│   │   ├── share.mapper.ts           # shareType 派生、hasPassword、状态
│   │   └── dto/*.dto.ts
│   ├── app-update/
│   │   ├── app-update.module.ts
│   │   ├── app.controller.ts         # /app-updates/apps
│   │   ├── version.controller.ts     # /app-updates/versions
│   │   ├── client.controller.ts      # /app-updates/check|download|report
│   │   ├── app-update.service.ts
│   │   ├── version-publish.service.ts# publish/offline/rollback/force
│   │   ├── version-scheduler.service.ts # 定时发布 + 灰度递增
│   │   ├── app-update-stats.service.ts
│   │   ├── apk-upload.interceptor.ts
│   │   └── dto/*.dto.ts
│   ├── metrics/{metrics.module,metrics.controller,metrics.service,qps.interceptor}.ts
│   ├── audit-log/{module,controller,service,dto}.ts
│   ├── placeholder/{module,controller,service,generators/default.ts}.ts
│   ├── photo/{module,controller,service}.ts
│   ├── hitokoto/{module,proxy.middleware}.ts
│   ├── health/{module,controller}.ts
│   └── spa/（如需 controller 化；当前由 bootstrap 中间件实现，保持中间件）
├── scripts/sync-db.ts               # 唯一 db:sync 入口
└── types/express.d.ts
```

职责边界：

- **controller**：只做参数接收、调用 service、组装审计日志；不直接访问 fs/ORM，不做业务判断（可保留 `ParseIntPipe` 等传输层校验）。
- **service**：纯业务与领域规则；不感知 HTTP 状态码以外的请求上下文（需要 IP/UA 时由 controller 传入）。
- **infra**：数据库、存储、根目录配置；不依赖 modules。
- **common**：无状态工具；不依赖 modules。
- 禁止散落 `process.env`：除 `config/*.ts` 与 `scripts/sync-db.ts`（脚本自身读取环境变量）外，其余代码一律 `ConfigService`。

---

## 3. 分层与约定

1. **响应信封**：所有成功响应由 `ResponseInterceptor` 包成 `{ code: 200, message: '成功', data }`；异常由 `HttpExceptionFilter` 输出 `{ code, message, data: null }`，`code` 取 HTTP 状态码。SSE/文件流（`@Res()` 直写）绕过拦截器，保持现有行为。
2. **异常语义**：`BadRequestException` 400、`UnauthorizedException` 401、`ForbiddenException` 403、`NotFoundException` 404、`ConflictException` 409、`GoneException` 410、`ThrottlerException` 429。提示文案逐字保留（见第 6 章）。
3. **分页**：统一 `PaginationQueryDto`（`page` 默认 1、`pageSize` 默认按各模块现有值，最大 100/500 按现状）+ 返回 `{ items, total, page, pageSize }`；分享/审计/重复文件/版本列表共用。
4. **路径安全**：所有磁盘路径经 `safeJoin(root, parts)`；`normalize` 后必须以「根 + 分隔符」开头；分类/文件名走 basename 校验（拒绝 `/`、`\`、`..`、空串、`. 开头`）；根目录 ID 只允许 `resource-roots.json` 中存在的条目，`roots` 为保留字。
5. **日志**：`LoggingInterceptor` 记录方法/路径/状态码/耗时；业务关键事件 `Logger.log`，可恢复失败 `warn`，不可恢复 `error`；禁止 `console.log`（脚本除外）。
6. **审计**：`AuditLogService.log()` fire-and-forget；写入点固定在 controller（与现状一一对应），字段 `userId/username/action/resourceType/resourceId/details/ip/userAgent/createdAt`。
7. **配置**：`ConfigService.get('server.port')` 等命名空间取值；启动期强校验（JWT_SECRET 非默认值、AUTH_USER/AUTH_PASS 必填）保留。
8. **模块依赖**：`modules/*` 可依赖 `infra/*` 与 `common/*`；`modules` 之间只允许通过导出 service 依赖（如 share → files、metrics → app-update 常量）。

---

## 4. 数据模型

实体以当前代码实际读写的列为准（旧列 `filePath`/`shareType` 不进入实体；仅在同步前做数据规整）。

| 实体 / 表 | 字段（类型） | 索引/约束 | 语义 |
| --- | --- | --- | --- |
| `FileEntryEntity` / `file_entries` | `id` PK 自增；`rootId` varchar64；`category` varchar255；`relPath` varchar1024；`name` varchar255；`ext` varchar32；`size` integer；`mtimeMs` integer；`contentHash` varchar64 nullable | `@Index(['rootId','category','relPath'], { unique: true })`；`contentHash` 普通索引 | 文件索引；`size` 为磁盘真实大小；`contentHash` 惰性补算（重复检测/上传去重） |
| `ShareLinkEntity` / `share_links` | `id`；`token` varchar64；`rootId`；`category`；`filePaths` **text NOT NULL**；`remark` nullable；`enabled` integer default 1；`expiresAt` nullable；`maxAccesses` nullable；`passwordHash` nullable；`accessCount` default 0；`createdAt` integer | `token` 唯一索引 | `filePaths` 为 JSON 数组字符串；`shareType` 不落库，按长度派生；`enabled=0` → 410 |
| `ShareAccessLogEntity` / `share_access_logs` | `id`；`shareToken`；`ip` nullable；`userAgent` nullable；`accessedAt` integer | `shareToken` 索引 | 每次成功 verify 记一条 |
| `AppVersionEntity` / `app_versions` | `id`；`platform` default 'android'；`appKey`；`versionName`；`versionCode`；`updateType` default 'apk'；`packageSize`；`checksum`；`storageRootId` default 'software-update'；`category`；`relPath`；`updateLog` text nullable；`forceUpdate` default 0；`minVersionCode` default 0；`grayPercent` default 0；`grayAutoIncrement` default 0；`grayIncrementSchedule` text nullable；`scheduledPublishAt` nullable；`scheduledPublishMode` default 'full'；`scheduledGrayPercent` default 0；`status` default 0；`offlineReason` nullable；`publishTime` nullable；`remark` nullable；`createdAt`；`updatedAt` | 唯一 `(platform, appKey, versionCode)` | `status` 0/1/2/3；`offlineReason` 三态 null/auto/manual；灰度百分比与递增表为 JSON |
| `AppUpgradeEventEntity` / `app_upgrade_events` | `id`；`deviceId` varchar128；`appKey` default 'default'；`fromVersionCode` nullable；`toVersionCode` nullable；`event` varchar32；`failCode` nullable；`networkType` nullable；`osVersion` nullable；`deviceModel` nullable；`costMs` nullable；`createdAt` | `event` 索引；`deviceId` 索引 | 漏斗事件；枚举 9 种 |
| `UserEntity` / `users` | `id`；`username` varchar32；`passwordHash` varchar255；`role` default 'user'；`createdAt`；`updatedAt` | `username` 唯一 | `updatedAt` 兼作 passwordChangedAt（JWT 时效校验） |
| `AuditLogEntity` / `audit_logs` | `id`；`userId` nullable；`username`；`action`；`resourceType`；`resourceId` nullable；`details` text nullable；`ip` nullable；`userAgent` nullable；`createdAt` | `action`/`resourceType`/`username`/`createdAt` 索引 | `details` 为 JSON 字符串 |

业务语义补充：

- `exists` 字段（文件列表返回）：由磁盘 `access()` 探测得出，不落库；磁盘缺失时 `size: null` 仅用于列表展示，不写回索引。
- `shareType`：`filePaths.length === 1 ? 'file' : 'collection'`；`hasPassword` 派生自 `passwordHash != null`。
- `expiresAt`/`maxAccesses` 为空表示无限制；列表状态筛选在内存/查询层派生为 `active/expired/exhausted/disabled`。

---

## 5. 数据库初始化与同步

保持既有机制不变（重构后必须仍可用）：

- **唯一同步实现**：`infra/database/ensure-schema.ts`
  - `normalizeLegacySharePaths()`：同步前把旧 `filePath` 回填到 `filePaths`、NULL/空串置 `[]`；
  - `syncSchema()`：`dataSource.synchronize()` + 快照 diff（createdTables/changedObjects/droppedObjects/legacyFixes/seededAdmin/alreadyCurrent）；
  - `assertSchemaReady()`：只校验表/列存在与 `share_links` 结构（禁旧列 `filePath`/`shareType`、`filePaths NOT NULL`）。
- **两处调用**：
  1. `scripts/sync-db.ts`（`pnpm db:sync`）：建库/改库 + 输出差异摘要 + 幂等播种管理员；
  2. `DatabaseBootstrapService.onModuleInit()`：开发环境按 `DB_SYNCHRONIZE` 决定是否 `syncSchema()`；生产环境忽略开关、只 `assertSchemaReady()` 并快速失败指向 `pnpm db:sync`。
- **无迁移文件、无版本号**：不引入 `migrations/`、不引入 TypeORM migration 运行。
- sql.js 配置：`type:'sqljs'`、`location=DB_PATH`（默认 `<cwd>/storage/vakao.db`）、`autoSave:true`、`synchronize:false`、`entities=DATABASE_ENTITIES`。
- 同步注意：`db:sync` 新建文件失败时删除半成品库；已有库失败不删。

---

## 6. 接口契约全表

>`/static` 为全局前缀（下表中「路径」均已含前缀）。「鉴权」列：`公开` / `JWT`；`JWT` 表示 `Authorization: Bearer`（同时兼容 `?token=`、`?auth=Bearer ...`）。响应除文件流/占位图/一言外均为 `{code,message,data}`。

### 6.1 认证 `/static/auth`（8）

| 方法 | 路径 | 鉴权 | 入参 | 返回 data | 错误 |
| --- | --- | --- | --- | --- | --- |
| POST | `/register` | JWT | `{username,password,role?}` | `UserInfo{id,username,role,createdAt}` | 400/401/403（非管理员建管理员）/409（重名） |
| POST | `/login` | 公开 | `{username,password}` | `{accessToken,tokenType,expiresIn,user}` | 400/401「用户名或密码错误」/429（5 次/分） |
| GET | `/profile` | JWT | — | `UserInfo` | 401 |
| POST | `/logout` | JWT | —（Bearer） | `{success:true}` | 401 |
| PATCH | `/password` | JWT | `{oldPassword,newPassword}` | `{success:true}` | 401「当前密码错误」/400 |
| GET | `/users` | JWT | — | `UserInfo[]`（createdAt 升序） | 401 |
| PATCH | `/users/:id/password` | JWT | `{newPassword}` | `{success:true}` | 400（重置自己）/403/404 |
| DELETE | `/users/:id` | JWT | — | `{success:true}` | 400（删自己/最后一个管理员）/404 |

### 6.2 文件 `/static/files`（19）

| 方法 | 路径 | 鉴权 | 入参 | 返回 data | 错误 |
| --- | --- | --- | --- | --- | --- |
| GET | `/config` | JWT | — | 文件配置对象 | 401 |
| GET | `/stats/usage` | JWT | — | 根/分类用量聚合 | 401 |
| GET | `/duplicates` | JWT | `rootId?`,`page=1`,`pageSize=20(≤100)` | `{groups,total,page,pageSize}` | 400/401 |
| GET | `/:rootId/categories` | JWT | — | `string[]` | 401（root 不存在时 500/400 见风险） |
| POST | `/:rootId/categories` | JWT | `{name}` | `{category,created}` | 400（非法/保留）/409 |
| DELETE | `/:rootId/categories/:category` | JWT | `recursive?` | `{removedEntries,...}` | 400/404/409 |
| PATCH | `/:rootId/categories/:category` | JWT | `{newCategory}` | 迁移结果 | 400/404/409 |
| GET | `/:rootId/:category` | JWT | `page=1`,`pageSize=100(≤500)`,`q`,`sort=name|size|mtime`,`order=asc|desc` | `{items,total,page,pageSize}` | 400/401 |
| POST | `/sync` | JWT | — | `{message:'ok'}` | 401 |
| POST | `/batch-delete` | JWT | `{rootId,category,paths[]}` | 删除结果 | 400/401 |
| POST | `/batch-move` | JWT | `{rootId,category,paths[],targetCategory}` | 移动结果 | 400/401 |
| POST | `/upload/init` | JWT | `{rootId,category,filename,size,chunkSize}` | `{uploadId,chunkSize,uploadedChunks[]}` | 400/401 |
| POST | `/upload/chunk?uploadId&index` | JWT | multipart 单文件（字段名 `file`，≤`CHUNK_FILE_SIZE_LIMIT`=100MB） | `{index,size}` | 400「No chunk uploaded」/400「上传已取消」 |
| POST | `/upload/complete` | JWT | `{uploadId,rootId,category,filename,size}` | 文件元信息 | 400（无分片/尺寸不匹配/已取消） |
| POST | `/upload/cancel` | JWT | `{uploadId}` | `{success:true}` | 400（uploadId 非法） |
| POST | `/:rootId/upload` | JWT | multipart `files[]` + `category` | 上传结果数组 | 400「No files uploaded」 |
| GET | `/:rootId/:category/*path` | **公开**（`@SkipThrottle`） | `download`,`w`,`h`,`q`,`format` | 文件流（200/206/304/416） | 400 路径非法/404 |
| PATCH | `/:rootId/:category/*path` | JWT | `{newName}` | 重命名结果 | 400/404/409 |
| DELETE | `/:rootId/:category/*path` | JWT | — | `{success:true}` | 404 |

### 6.3 分享 `/static/share`（8）

| 方法 | 路径 | 鉴权 | 入参 | 返回 data | 错误 |
| --- | --- | --- | --- | --- | --- |
| POST | `/` | JWT | `{rootId,category,filePaths[1..200],remark?,expiresInMs?,maxAccesses?,password?}` | 分享对象（含 token/shareType） | 400（空/超 200/路径非法） |
| GET | `/list` | JWT | `page=1`,`pageSize=10(≤100)`,`q`,`status` | `{items,total,page,pageSize}` | 400/401 |
| PATCH | `/:token` | JWT | `{remark?,expiresAt?,password?,maxAccesses?,enabled?}`（null 清空） | 分享对象 | 400/404 |
| GET | `/:token/access-logs` | JWT | — | 访问日志数组 | 404 |
| DELETE | `/:token` | JWT | — | `{success:true}` | 404 |
| GET | `/:token/info` | 公开 | — | `{share, files?}` | 410 停用/400 过期或超限 |
| POST | `/:token/verify` | 公开 | `{password?}` | 解锁结果+`accessToken` | 401（需密码/密码错误）/400/410/429（10 次/分） |
| GET | `/:token` | 公开 | `index?`,`accessToken?`,`download`,`w/h/q/format` | 单文件流 / 多文件列表 | 401/400/410/404 |

### 6.4 APP 更新 `/static/app-updates`（18）

客户端（3）：

| 方法 | 路径 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/check` | 公开 | `platform`, `appKey`, `versionCode`, `versionName?`, `deviceId?` | 更新信息或 `{hasUpdate:false,...}` |
| GET | `/download/:id` | 公开 | — | APK 流（200/206/304/416） |
| POST | `/report` | 公开 | `{deviceId,appKey,event,fromVersionCode?,toVersionCode?,failCode?,networkType?,osVersion?,deviceModel?,costMs?}` | `{success:true}` |

管理端-应用（4）：

| 方法 | 路径 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/apps` | JWT | — | 应用列表 |
| POST | `/apps` | JWT | `{appKey}` | 应用 |
| PATCH | `/apps/:appKey` | JWT | `{newAppKey}` | 应用 |
| DELETE | `/apps/:appKey` | JWT | — | `{success:true}` |

管理端-版本（11）：

| 方法 | 路径 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| POST | `/versions` | JWT | multipart `file` + `appKey/versionName/versionCode/updateLog?/remark?` | 版本 |
| GET | `/versions` | JWT | `page`,`pageSize`,`status?`,`appKey?`,`platform?` | `{items,total,page,pageSize}` |
| GET | `/versions/stats/funnel` | JWT | `appKey!`,`startTime?`,`endTime?` | 漏斗计数 |
| GET | `/versions/:id` | JWT | — | 版本详情 |
| GET | `/versions/:id/rollback-candidates` | JWT | — | 候选列表 |
| PATCH | `/versions/:id` | JWT | `{versionName?,updateLog?,remark?,scheduledPublishAt?,scheduledPublishMode?,scheduledGrayPercent?}` | 版本 |
| POST | `/versions/:id/publish` | JWT | `{mode:'full'|'gray',grayPercent?,grayAutoIncrement?,grayIncrementSchedule?}` | 版本 |
| PUT | `/versions/:id/force` | JWT | `{forceUpdate,minVersionCode?}` | 版本 |
| POST | `/versions/:id/offline` | JWT | — | 版本 |
| POST | `/versions/:id/rollback` | JWT | — | 版本 |
| DELETE | `/versions/:id` | JWT | — | `{success:true}` |

### 6.5 资源根 `/static/roots`（5）

| 方法 | 路径 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/` | JWT | — | `ResourceRoot[]` |
| POST | `/` | JWT | `{id,name,path}` | 根目录 |
| DELETE | `/:id` | JWT | — | `{success:true}` |
| PATCH | `/:id` | JWT | `{id?,name?,path?}` | 根目录 |
| GET | `/system/directories?path` | JWT | 路径 | 目录列表 |

### 6.6 系统与工具

| 方法 | 路径 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/static/health` | 公开 | — | `{status:'ok'}` |
| GET | `/static/metrics` | 公开 | — | 指标对象 |
| GET | `/static/audit-logs` | JWT | `page`,`pageSize`,`action?`,`resourceType?`,`username?`,`startTime?`,`endTime?` | `{items,total,page,pageSize}` |
| GET | `/static/photo` | 公开 | `width?`,`height?`,`category?`,`rootId?` | 图片流 |
| GET | `/static/placeholder` | 公开 | `width?`,`height?`,`text?`,`bgColor?`,`textColor?`,`fontFamily?`,`fontWeight?`,`fontSize?` | SVG |
| GET | `/static/placeholder/:size` | 公开 | 同上 | SVG |
| GET | `/static/placeholder/:width/:height` | 公开 | 同上 | SVG |
| ANY | `/static/hitokoto/*path` | 公开 | 透传 | 上游响应；上游不可用 503 |

---

## 7. 安全策略

1. **Helmet CSP**：保持现有保守配置（`default-src 'self'`；`script-src` 含 `'unsafe-inline'/'unsafe-eval'`；`img/media/frame/connect` 允许 `data: blob: http: https:`；`object-src 'none'`）；`crossOriginEmbedderPolicy:false`、`crossOriginResourcePolicy:'cross-origin'`，不得回退。
2. **限流**：全局 `300 req / 60s / IP`；登录 `5/60s`；分享 verify `10/60s`；静态文件直出 `@SkipThrottle`。命中返回 429（信封格式）。
3. **上传大小**：普通 multipart 受 `BODY_LIMIT`（10MB）约束；分片单块硬上限 `CHUNK_FILE_SIZE_LIMIT`（默认 100MB）；APK 单包硬上限 500MB（现有拦截器）。
4. **路径穿越**：`safeJoin` + basename 校验 + 根目录存在性校验；非法路径 400；根 ID `roots` 保留；`resource-roots.json` 为唯一根白名单（读写经 `ResourceRootsService`）。
5. **JWT**：`JWT_SECRET` 启动强校验；`expiresIn` 默认 12h；登出黑名单；改密/删用户使旧 token 失效。
6. **审计**：见第 1 章 62；登录失败不写审计（与现状一致）。
7. **Swagger**：`ENABLE_SWAGGER=false` 时不挂载（生产可关）。
8. **CORS**：默认关闭；`CORS_ORIGIN` 逗号白名单，`'*'` 表示全放通（保留现有 `'*'` 特殊处理）。

---

## 8. 执行计划（分阶段）

每阶段结束门禁：`pnpm typecheck` && `pnpm lint` && `pnpm build` 通过；用隔离库副本启动服务并冒烟（`/static/health` + 登录 + 本阶段端点）。阶段间保持服务可启动：先建新结构，再逐模块切换，旧文件在对应阶段删除。

| 阶段 | 内容 | 提交粒度 | 验收 |
| --- | --- | --- | --- |
| P0 基线 | 当前 main 采集 73 端点响应形状快照 + 错误码表；隔离库副本 | 1 commit（仅 `/tmp` 产物，不入库） | 快照可复现 |
| P1 骨架与基础设施 | `common/`、`config/`、`infra/{database,storage,resource-roots,swagger,bootstrap}`、`main.ts` 重写；实体迁移到 `infra/database/entities`；`ensure-schema`/`sync-db` 保留 | 1 commit | 服务可启动、`/health`、`/docs`、DB 两模式 |
| P2 认证与用户 | `modules/auth` + `modules/users` 重写；JWT 策略、黑名单、审计 | 1 commit | 8 端点全绿 + token 失效矩阵 |
| P3 文件与上传 | `modules/files` 拆分 service（files/upload/file-index/duplicate/usage/image/cleanup）+ `modules/roots` | 1 commit | 19+5 端点 + Range/分片续传 |
| P4 分享 | `modules/share` 拆分（share/access/cleanup/mapper） | 1 commit | 8 端点 + 410/401/429 |
| P5 APP 更新与统计 | `modules/app-update` 拆分（app/version/client/publish/scheduler/stats） | 1 commit | 18 端点 + 并发 publish/rollback |
| P6 系统与后台任务 | `modules/{metrics,audit-log,placeholder,photo,hitokoto,health}` + 三个 Cron 归位 | 1 commit | 6 组端点 + Cron 手动触发 |
| P7 收尾 | 删除残留旧文件、统一命名、文档更新（README 后端章节如有） | 1 commit | 全量门禁 + 契约比对 |

分支与提交：仅在 `refactor/backend` 提交；**不 push、不动 `main`**；方案文档单独先提交一次。

---

## 9. 风险与不做项

### 9.1 本次不做

- 不引入 PostgreSQL/MySQL，不更换 sql.js。
- 不做目录级打包下载、不做分享目录递归授权。
- 不改前端任何代码、不改共享类型（`@vakao/shared`）字段。
- 不新增迁移文件/版本化升级；不引入 TypeORM migration 运行。
- 不改变现有对外契约（含 Swagger 文档的 `/static/static` 路径重复现象）。
- 不做多实例部署改造（Token 黑名单仍为进程内）。

### 9.2 风险

1. **sql.js 全量写盘**：并发写（publish 三路、分片 complete）依赖单线程事件循环；重构时不得引入并行事务，否则可能破坏「仅 1 个 PUBLISHED」。
2. **文件索引与磁盘一致性**：重命名/移动/删除需同步 `file_entries` 与 `share_links.filePaths`，漏一处会导致分享失效。
3. **定时任务归位**：清理任务跨 files/share，拆分后需保证「每日 03:00 一次、顺序不变」。
4. **旧库数据规整**：`normalizeLegacySharePaths` 必须在 `synchronize()` 之前执行，且 `assertSchemaReady` 的严格校验不能放宽。
5. **审计 fire-and-forget**：重构后写入点数量必须与现状一致（以基线审计记录条数为准）。

### 9.3 建议（不在本次改动，待用户决定）

1. **Swagger 前缀重复**：`setGlobalPrefix('static')` 后再 `SwaggerModule.setup('docs')`，导致文档路径显示 `/static/static/...`；建议改为 `SwaggerModule.setup('docs', app, doc, { useGlobalPrefix: false })` 或挂到 `/static/docs`，属**契约/文档可见变化**，需用户确认。
2. **分享过期语义不一致**：停用用 410，过期/超限用 400；建议统一为 410（Gone），但会改变前端错误分支。
3. **`/files/:rootId/categories` 根不存在时的状态码**：现状可能落到 500；建议明确 404。
4. **Token 黑名单进程内**：多实例部署会失效；建议后续外置 Redis（非本次范围）。
5. **`accessToken` 分享解锁凭证形态**：现状由 `share.service` 内部生成，建议在契约文档中固化算法/时效。
