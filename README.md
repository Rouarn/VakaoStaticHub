# Vakao Static Hub

<p align="center">
  <img src="./packages/frontend/public/intro.svg" width="300" height="155" alt="Vakao Static Hub Logo" />
</p>

基于 **NestJS 12** + **Vue 3** 的静态资源管理系统，采用 pnpm monorepo（`packages/shared` / `packages/backend` / `packages/frontend`）。提供多根目录文件管理、随机图片服务、占位图生成、一言代理、文件分享链接和 APP 在线更新中心等能力。

> 前端文档：参见 [packages/frontend/README.md](./packages/frontend/README.md)

---

## 核心特性

- **多根目录管理**：动态增删资源根目录，配置持久化到 `resource-roots.json`，支持服务器目录浏览；系统启动时会幂等注册内置 `software-update` 根目录
- **文件管理**：上传、删除、重命名、分页浏览、关键词搜索、多字段排序（名称 / 大小 / 修改时间）；支持批量删除、批量移动分类
- **大文件分片上传**：5MB 分片 + 断点续传，上传中断后可从断点继续，合并时校验 SHA-256
- **重复文件检测**：`file_entries` 记录内容 SHA-256，按哈希分组找出重复副本，前端可视化对比与清理
- **存储用量统计**：按根目录 / 分类聚合占用空间与文件数，前端进度条可视化
- **文件索引**：SQLite (sql.js) + TypeORM，启动时全量扫描，每 5 分钟自动同步，根目录变更时事件驱动刷新
- **图片处理**：基于 Sharp，支持缩放、格式转换（webp/jpeg/png）、质量调节，磁盘缓存 `{FILE_ROOT}/.cache/thumbnails`
- **随机图片服务**：单入口查询参数路由（根目录 / 分类 / 尺寸多维度组合），扫描文件系统并内置洗牌缓存
- **占位图生成**：SVG 占位图动态生成，支持尺寸、颜色、文字、字体、字重自定义，带 ETag 协商缓存
- **一言代理**：反向代理 `hitokoto` 服务，支持任意方法转发并记录请求日志
- **文件分享链接**：单文件 / 多文件聚合分享，可设有效期、最大访问次数与访问密码（scrypt 哈希 + HMAC 短期访问令牌），访问记录持久化（IP / UA / 时间），支持撤销
- **APP 在线更新中心**：多应用（appKey）独立版本管理，APK 上传自动计算 SHA-256，草稿/灰度/全量/下架四态 + `offlineReason` 区分自动下架 vs 手动止血，灰度按设备哈希稳定分桶，灰度自动递增与定时发布，一键回滚只恢复被新全量自动挤掉的历史版本（不会误恢复手动下架的），强更开关与最低兼容版本，APK 下载支持 HTTP Range 断点续传，升级事件上报 + 漏斗统计看板，全量发布事务内前置 OFFLINE 保证并发安全（同一时刻只有 1 个 PUBLISHED）
- **操作审计日志**：关键操作（登录、上传、删除、发布、分享等）持久化到 `audit_logs` 表，支持按用户 / 操作 / 资源类型筛选查询
- **监控指标**：`GET /static/metrics` 提供 QPS、内存占用、存储总量、活跃分享数、应用 / 版本数、24h 升级事件量
- **安全加固**：Helmet 安全响应头、全局速率限制、JWT 登出吊销（内存黑名单）、修改密码、用户管理（列表 / 创建 / 删除 / 角色 / 管理员重置密码，后端校验禁止删除自己且至少保留一个管理员）
- **统一鉴权**：users 表 + 密码哈希，JWT（Bearer Token），注册需登录（管理员创建账号）；`AUTH_USER/AUTH_PASS` 仅用于首次启动播种默认管理员
- **定时清理**：每日凌晨自动清理孤儿缩略图缓存与过期 / 超限分享链接记录
- **API 文档**：Swagger UI `/docs`
- **统一响应格式**：全局拦截器包装 `{ code, message, data }`
- **SPA 支持**：生产模式下自动挂载前端静态资源并提供 fallback

---

## 技术栈

| 层级     | 技术                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 运行时   | Node.js >= 22.18.0（.nvmrc 推荐 24）                                      |
| 框架     | NestJS 12 + Express 5                                                     |
| 语言     | TypeScript 6.x                                                            |
| 数据库   | SQLite (sql.js + TypeORM)                                                 |
| 认证     | @nestjs/jwt + passport-jwt                                                |
| 安全     | helmet + @nestjs/throttler                                                |
| 文件上传 | multer 2                                                                  |
| 校验     | class-validator + class-transformer                                       |
| 图片处理 | Sharp                                                                     |
| 定时任务 | @nestjs/schedule                                                          |
| 事件     | @nestjs/event-emitter                                                     |
| 反向代理 | http-proxy-middleware 4                                                   |
| API 文档 | @nestjs/swagger                                                           |
| 共享类型 | @vakao/shared（monorepo 内部包，前后端共用）                              |
| 前端     | Vue 3 + Vite + NaiveUI（见 [前端 README](./packages/frontend/README.md)） |
| 包管理   | pnpm >= 10.15.0（workspace monorepo，`nodeLinker: hoisted`）              |

---

## 快速开始

```bash
# 1. 安装依赖（sharp 等原生模块已在 pnpm-workspace.yaml 中放行，无需 approve-builds）
pnpm install

# 2. 启动后端（开发模式，热重载）
pnpm dev:backend

# 3. 另开终端，启动前端（开发模式，热重载）
pnpm dev:frontend

# 或一键同时启动（会先构建 @vakao/shared，再并行 shared/backend/frontend）
pnpm dev
```

默认端口：

| 服务     | 地址                                | 说明                           |
| -------- | ----------------------------------- | ------------------------------ |
| 后端 API | http://localhost:9865               | 所有接口前缀 `/static`         |
| 前端     | http://localhost:9867               | 开发服务器                     |
| API 文档 | http://localhost:9865/docs          | Swagger UI（不受全局前缀影响） |
| 健康检查 | http://localhost:9865/static/health | 返回 `{ status: "ok" }`        |

---

## 环境变量

配置位于 `packages/backend/src/config/` 下各模块的配置文件中，均从环境变量读取，提供默认值。可参考根目录 [.env.example](./.env.example)。

### 服务器

| 变量             | 默认值   | 说明                                                                 |
| ---------------- | -------- | -------------------------------------------------------------------- |
| `PORT`           | `9865`   | 后端监听端口                                                         |
| `BODY_LIMIT`     | `10mb`   | JSON 请求体大小限制（不作用于 multipart 上传；APK 单包硬上限 500MB） |
| `STATIC_PREFIX`  | `static` | API 与静态文件 URL 前缀                                              |
| `CORS_ORIGIN`    | `''`     | 跨域来源白名单，逗号分隔；留空不开放跨域，填 `*` 放通全部来源        |
| `ENABLE_SWAGGER` | `true`   | 是否挂载 Swagger 文档（`/docs`），生产环境建议关闭                   |

### 认证

| 变量             | 默认值             | 说明                                          |
| ---------------- | ------------------ | --------------------------------------------- |
| `AUTH_USER`      | `admin`            | 首次启动 users 表为空时播种的默认管理员用户名 |
| `AUTH_PASS`      | `admin`            | 首次启动 users 表为空时播种的默认管理员密码   |
| `JWT_SECRET`     | `change-me-in-env` | JWT 签名密钥（生产环境务必修改）              |
| `JWT_EXPIRES_IN` | `12h`              | Token 过期时间                                |

> 后续新增用户通过 `POST /static/auth/register` 完成，账号密码持久化在 users 表（密码哈希存储），`AUTH_USER/AUTH_PASS` 不再参与运行期校验。

### 数据库

| 变量             | 默认值                   | 说明                                                                                                          |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `DB_PATH`        | `<cwd>/storage/vakao.db` | SQLite 文件路径                                                                                               |
| `DB_SYNCHRONIZE` | `false`                  | 仅开发环境生效：`true` 时启动自动按实体同步表结构并播种，`false` 时完全不碰结构。生产环境忽略该开关，结构变更走 `pnpm db:sync` |

### 文件

| 变量                     | 默认值                                       | 说明                                                                                                              |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FILE_ROOT`              | `<cwd>/storage`                              | 文件存储根目录                                                                                                     |
| `UPLOAD_MAX_COUNT`       | `20`                                         | 单次上传最大文件数                                                                                                 |
| `DEFAULT_CATEGORY`       | `TemporaryFile`                             | 默认分类目录名                                                                                                     |
| `UPLOAD_TEMP_DIR`        | `<os.tmpdir()>/vakao-static-hub/uploads`     | 分片上传临时目录；默认落在操作系统临时目录下的应用专属子目录。线上如 `/tmp` 挂 tmpfs 且内存吃紧，可指回磁盘目录（如 `/var/vakao-uploads`） |
| `CHUNK_FILE_SIZE_LIMIT`  | `104857600`（100MB）                         | 单个分片文件硬上限（字节），防超大 buffer 打垮进程内存                                                            |

### 定时任务

| 变量                        | 默认值          | 说明                 |
| --------------------------- | --------------- | -------------------- |
| `CACHE_REFRESH_INTERVAL_MS` | `300000` (5min) | 缓存刷新间隔（毫秒） |

### 一言代理

| 变量               | 默认值 | 说明                              |
| ------------------ | ------ | --------------------------------- |
| `HITOKOTO_API_URL` | `''`   | 一言 API 目标地址，留空则禁用代理 |

### APP 在线更新

| 变量                  | 默认值 | 说明                                                                               |
| --------------------- | ------ | ---------------------------------------------------------------------------------- |
| `APP_PUBLIC_BASE_URL` | -      | APK 下载链接的外部可访问基址；缺省时从请求头（`x-forwarded-*` / 协议主机）动态拼接 |

---

## 目录结构

```
vakao-static-hub/
├── packages/
│   ├── shared/                      # @vakao/shared：前后端共享类型（ApiResponse、模型等）
│   │   └── src/{api,models,index}.ts
│   ├── backend/                     # @vakao/backend：NestJS 后端
│   │   └── src/
│   │       ├── main.ts              # 入口：启动 NestJS，注册中间件/拦截器/过滤器/Swagger/SPA fallback
│   │       ├── app.module.ts        # 根模块
│   │       ├── app.controller.ts    # 健康检查 /static/health
│   │       ├── common/
│   │       │   ├── response.interceptor.ts    # 统一 { code, message, data }
│   │       │   ├── http-exception.filter.ts   # 统一错误响应
│   │       │   ├── decorators/current-user.decorator.ts
│   │       │   └── interceptors/{logging,configurable-files}.interceptor.ts
│   │       ├── config/              # app-config / auth / database / file / schedule / server
│   │       ├── infra/
│   │       │   ├── database/
│   │       │   │   ├── database.module.ts
│   │       │   │   └── entities/    # file-entry / user / share-link / share-access-log / app-version / app-upgrade-event / audit-log
│   │       │   └── resource-roots/  # resource-roots.json 多根目录 CRUD + 事件广播
│   │       ├── modules/
│   │       │   ├── auth/            # 登录 / 注册 / 改密 / 登出 / 用户管理，JWT 策略 + Token 黑名单，@Public 白名单装饰器
│   │       │   ├── files/           # 文件 CRUD / 批量操作 / 分片上传 / 重复检测 / 用量统计 / 索引同步 / Sharp 图片处理
│   │       │   ├── roots/           # 资源根目录管理 + 服务器目录浏览
│   │       │   ├── photo/           # 随机图片（查询参数路由 + 洗牌缓存）
│   │       │   ├── placeholder/     # SVG 占位图生成
│   │       │   ├── hitokoto/        # 一言反向代理
│   │       │   ├── share/           # 分享链接（单文件/聚合、访问密码、访问记录、有效期/次数）
│   │       │   ├── app-update/      # APP 在线更新（应用/版本管理、回滚、灰度递增、定时发布、漏斗统计、客户端检查/下载/上报）
│   │       │   ├── audit-log/       # 操作审计日志（异步写入 + 查询接口）
│   │       │   └── metrics/         # 监控指标（QPS / 内存 / 存储 / 分享 / 升级事件）
│   │       ├── utils/{file-serve,size}.util.ts
│   │       └── types/express.d.ts
│   └── frontend/                    # @vakao/frontend：Vue 3 + Vite
├── script/deploy.js                 # 一键打包部署
├── pnpm-workspace.yaml              # workspace + nodeLinker: hoisted + allowBuilds
└── resource-roots.json              # 运行时生成的资源根目录配置
```

---

## API 概览

所有业务接口前缀 `/static`（由 `STATIC_PREFIX` 控制），Swagger UI 位于 `/docs`。统一响应格式：

```json
{
  "code": 200,
  "message": "成功",
  "data": { ... }
}
```

### 认证

| 方法   | 路径                     | 说明                                 | 认证 |
| ------ | ------------------------ | ------------------------------------ | ---- |
| POST   | `/static/auth/login`     | 登录，返回 JWT                       | 否   |
| POST   | `/static/auth/register`  | 创建新用户（需登录后调用，body 可带 `role: admin \| user`，创建管理员仅管理员可操作） | 是   |
| GET    | `/static/auth/profile`   | 获取当前登录用户信息（含 `role`）                                  | 是   |
| POST   | `/static/auth/logout`    | 登出（当前 Token 立即加入黑名单）                                  | 是   |
| PATCH  | `/static/auth/password`  | 修改当前用户密码                                                  | 是   |
| GET    | `/static/auth/users`     | 用户列表（不含密码哈希，含 `role`）                                | 是   |
| DELETE | `/static/auth/users/:id` | 删除用户（后端校验：禁止删除自己、至少保留一个管理员）             | 是   |
| PATCH  | `/static/auth/users/:id/password` | 管理员重置他人密码（body: `{ newPassword }`）              | 是（仅管理员） |

### 资源根目录

| 方法   | 路径                                     | 说明           | 认证 |
| ------ | ---------------------------------------- | -------------- | ---- |
| GET    | `/static/roots`                          | 获取所有根目录 | 是   |
| POST   | `/static/roots`                          | 添加根目录     | 是   |
| PATCH  | `/static/roots/:id`                      | 更新根目录     | 是   |
| DELETE | `/static/roots/:id`                      | 删除根目录     | 是   |
| GET    | `/static/roots/system/directories?path=` | 浏览服务器目录 | 是   |

### 文件管理

| 方法   | 路径                                          | 说明                                                | 认证       |
| ------ | --------------------------------------------- | --------------------------------------------------- | ---------- |
| GET    | `/static/files/config`                        | 获取文件管理配置（defaultCategory 等）              | 是         |
| GET    | `/static/files/stats/usage`                   | 存储用量统计（按根目录/分类聚合）                   | 是         |
| GET    | `/static/files/duplicates?rootId=&page=&pageSize=` | 重复文件检测（按 contentHash 分组，服务端分页，`groupCount` 为分页前总组数） | 是         |
| POST   | `/static/files/sync`                          | 强制同步文件索引（重新扫描磁盘并刷新数据库）        | 是         |
| POST   | `/static/files/batch-delete`                  | 批量删除文件（body: `{ rootId, category, paths }`） | 是         |
| POST   | `/static/files/batch-move`                    | 批量移动文件到另一个分类                            | 是         |
| POST   | `/static/files/upload/init`                   | 分片上传初始化，返回 uploadId                       | 是         |
| POST   | `/static/files/upload/chunk?uploadId=&index=` | 上传单个分片                                        | 是         |
| POST   | `/static/files/upload/complete?uploadId=`     | 合并分片并校验 SHA-256                              | 是         |
| POST   | `/static/files/upload/cancel?uploadId=`       | 取消分片上传并清理临时文件                          | 是         |
| GET    | `/static/files/:rootId/categories`            | 获取分类列表                                        | 是         |
| POST   | `/static/files/:rootId/categories`            | 新建空分类（body: `{ name }`；拒绝 `software-update` 根、默认分类与路径分隔符） | 是         |
| PATCH  | `/static/files/:rootId/categories/:category`  | 重命名分类（body: `{ newCategory }`）               | 是         |
| DELETE | `/static/files/:rootId/categories/:category?recursive=` | 删除分类（仅一级路径；非空需 `recursive=true`，否则 409；拒绝默认分类与 `software-update` 根） | 是         |
| GET    | `/static/files/:rootId/:category`             | 分页查询文件列表                                    | 是         |
| POST   | `/static/files/:rootId/upload`                | 普通上传文件 (multipart)                            | 是         |
| GET    | `/static/files/:rootId/:category/*path`       | 下载/预览文件                                       | 否（公开） |
| PATCH  | `/static/files/:rootId/:category/*path`       | 重命名文件（body: `{ newName }`）                   | 是         |
| DELETE | `/static/files/:rootId/:category/*path`       | 删除文件                                            | 是         |

**分页查询参数**：

| 参数       | 默认值  | 上限 | 说明                                |
| ---------- | ------- | ---- | ----------------------------------- |
| `page`     | `1`     | -    | 页码                                |
| `pageSize` | `100`   | 500  | 每页数量                            |
| `q`        | -       | -    | 搜索关键词（匹配文件名和路径）      |
| `sort`     | `mtime` | -    | 排序字段：`name` / `size` / `mtime` |
| `order`    | `desc`  | -    | 排序方向：`asc` / `desc`            |

**文件预览/下载参数**：

| 参数       | 说明                        |
| ---------- | --------------------------- |
| `download` | 存在即强制下载              |
| `w`        | 图片缩放宽度                |
| `h`        | 图片缩放高度                |
| `q`        | 图片质量 1-100（默认 80）   |
| `format`   | 输出格式：webp / jpeg / png |

**协商缓存**：原图下载接口支持 `ETag`（弱 ETag）和 `If-None-Match`，命中返回 `304`；经 Sharp 处理后的图片响应不携带 ETag。

### 随机图片

| 方法 | 路径                                             | 说明                                   | 认证 |
| ---- | ------------------------------------------------ | -------------------------------------- | ---- |
| GET  | `/static/photo?rootId=&category=&width=&height=` | 按根目录 / 分类 / 尺寸组合返回随机图片 | 否   |

- 四个参数均可选：全缺省为全局随机；仅 `rootId` 限定根目录；仅 `category` 跨根目录按分类聚合
- 未传尺寸时以原格式 q80 经 Sharp 处理后返回；同时传宽高时输出 webp
- 缓存每 5 分钟或根目录变更时刷新，刷新后 Fisher-Yates 洗牌

### 占位图

| 方法 | 路径                                                                                             | 说明             | 认证 |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------- | ---- |
| GET  | `/static/placeholder`                                                                            | 默认 300×150     | 否   |
| GET  | `/static/placeholder?width=&height=&text=&bgColor=&textColor=&fontFamily=&fontWeight=&fontSize=` | 自定义占位图     | 否   |
| GET  | `/static/placeholder/:size`                                                                      | 正方形占位图     | 否   |
| GET  | `/static/placeholder/:width/:height`                                                             | 自定义尺寸占位图 | 否   |

### 一言

| 方法 | 路径                     | 说明               | 认证 |
| ---- | ------------------------ | ------------------ | ---- |
| ALL  | `/static/hitokoto/*path` | 代理转发到一言服务 | 否   |

未配置 `HITOKOTO_API_URL` 时不再透传为 404，而是返回 **503** `{ statusCode: 503, code: "HITOKOTO_PROXY_DISABLED", message: "一言代理未启用：未配置 HITOKOTO_API_URL" }`，前端据此提示「一言代理未启用」。

### 分享链接

| 方法   | 路径                               | 说明                                                        | 认证       |
| ------ | ---------------------------------- | ----------------------------------------------------------- | ---------- |
| POST   | `/static/share`                    | 创建分享链接（单文件/聚合、有效期、次数、密码、备注）       | 是         |
| GET    | `/static/share/list?page=&pageSize=&q=&status=` | 分享链接列表：服务端分页 + 关键字（token/路径/分类/备注）+ 状态筛选，返回 `counts` | 是         |
| PATCH  | `/static/share/:token`             | 编辑备注 / 有效期 / 密码 / 最大访问次数 / 启停              | 是         |
| DELETE | `/static/share/:token`             | 撤销分享链接                                                | 是         |
| GET    | `/static/share/:token/info`        | 获取分享元信息（类型、文件名、是否需密码等）                | 否（公开） |
| POST   | `/static/share/:token/verify`      | 校验访问密码，返回短期访问令牌（HMAC）                      | 否（公开） |
| GET    | `/static/share/:token/access-logs` | 获取该分享的访问记录（仅创建者）                            | 是         |
| GET    | `/static/share/:token`             | 访问分享文件（支持 `download/w/h/q/format`、`accessToken`） | 否（公开） |

> 前端公开访问页路由为 `/share/:token`（无 `/static` 前缀），生产环境由 SPA fallback 渲染，页面内再调用上述 API。

- 分享状态：`active` / `expired` / `exhausted` / `disabled`；停用后访问公开接口返回 **410 Gone** `{ "message": "分享链接已停用" }`，与不存在的 404 明确区分。
- **目录分享不支持**：服务端未提供整目录打包下载能力，前端只支持单文件或文件集合；如需目录分享，需要先新增服务端打包（zip/tar）与目录遍历鉴权能力，当前未实现，前端已明确提示。

### APP 在线更新

**客户端接口（公开）**

| 方法 | 路径                                                                                      | 说明                                  | 认证 |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------- | ---- |
| GET  | `/static/app-updates/check?platform=android&appKey=&versionCode=&versionName?=&deviceId?` | 版本检查（以 versionCode 为判定基准） | 否   |
| GET  | `/static/app-updates/download/:id`                                                        | 下载 APK（支持 HTTP Range 断点续传）  | 否   |
| POST | `/static/app-updates/report`                                                              | 升级事件上报                          | 否   |

**应用管理（需认证）**

| 方法   | 路径                               | 说明                                           | 认证 |
| ------ | ---------------------------------- | ---------------------------------------------- | ---- |
| GET    | `/static/app-updates/apps`         | 列出全部应用（software-update 根下的分类目录） | 是   |
| POST   | `/static/app-updates/apps`         | 新建应用（`{ appKey }`）                       | 是   |
| PATCH  | `/static/app-updates/apps/:appKey` | 重命名应用（迁移全部关联记录）                 | 是   |
| DELETE | `/static/app-updates/apps/:appKey` | 删除应用（目录 + 全部版本/事件/索引记录）      | 是   |

**版本管理（需认证）**

| 方法   | 路径                                                           | 说明                                                             | 认证 |
| ------ | -------------------------------------------------------------- | ---------------------------------------------------------------- | ---- |
| POST   | `/static/app-updates/versions`                                 | 上传 APK 并创建草稿版本（multipart，自动算大小与 SHA-256）       | 是   |
| GET    | `/static/app-updates/versions?page=&pageSize=&status=&appKey=&platform=` | 分页版本列表（`platform` 可选过滤）                    | 是   |
| GET    | `/static/app-updates/versions/:id`                             | 版本详情                                                         | 是   |
| GET    | `/static/app-updates/versions/:id/rollback-candidates`         | 服务端直接返回可回滚候选（前端不再自行筛选 `offlineReason`）     | 是   |
| PATCH  | `/static/app-updates/versions/:id`                             | 编辑元数据（仅草稿/已下架可改）                                  | 是   |
| POST   | `/static/app-updates/versions/:id/publish`                     | 发布（`full` 全量 / `gray` 灰度，带门禁校验）                    | 是   |
| POST   | `/static/app-updates/versions/:id/rollback`                    | 一键回滚到上一个全量版本                                         | 是   |
| PUT    | `/static/app-updates/versions/:id/force`                       | 远程修改强更开关（逃生口，无需重新发版）                         | 是   |
| POST   | `/static/app-updates/versions/:id/offline`                     | 一键下架（止血开关，文件保留）                                   | 是   |
| DELETE | `/static/app-updates/versions/:id`                             | 物理删除（仅草稿/已下架，删除 APK 文件及全部关联记录，不可恢复） | 是   |
| GET    | `/static/app-updates/stats/funnel?appKey=&startTime=&endTime=` | 升级漏斗统计（check/download/install 转化率）                    | 是   |

版本状态：`0` 草稿 / `1` 灰度 / `2` 全量 / `3` 已下架；`(platform, appKey, versionCode)` 唯一。

下架版本额外带 `offlineReason` 字段（仅 `status=3` 时有意义）：

| `offlineReason` | 来源                                   | rollback 可恢复？ |
| --------------- | -------------------------------------- | ----------------- |
| `null`          | 从未全量发布过的版本被下架（非正常态） | ❌                |
| `'auto'`        | 被新全量 publish 自动挤掉              | ✅                |
| `'manual'`      | 管理员手动止血下架 / rollback 自身下架 | ❌                |

**回滚候选口径**：同应用同平台、`versionCode < 目标版本`、且满足 `(status=PUBLISHED) OR (status=OFFLINE AND offlineReason='auto')`。从未发布过的草稿/灰度（`status=0/1`）、手动止血下架的版本（`offlineReason='manual'`）、版本号 ≥ 目标的都不会被误当成回滚目标。

### 审计日志

| 方法 | 路径                                                   | 说明                 | 认证 |
| ---- | ------------------------------------------------------ | -------------------- | ---- |
| GET  | `/static/audit-logs?page=&pageSize=&action=&username=` | 操作审计日志分页查询 | 是   |

### 监控指标

| 方法 | 路径              | 说明                                                         | 认证 |
| ---- | ----------------- | ------------------------------------------------------------ | ---- |
| GET  | `/static/metrics` | QPS、内存、存储总量、活跃分享数、应用/版本数、24h 升级事件量、`health` 段（数据库连通性 + DB 文件绝对路径与大小） | 是   |

`health` 段结构：`{ status: 'ok' | 'degraded', database: { ok, path, sizeBytes } }`。无数据的指标（如空根目录 `totalSize`、无升级事件的事件类型计数、DB 文件不可读时的 `sizeBytes`）返回 `null` 而不是 `0`，前端展示为 `—`。

---

## 架构设计要点

### 多根目录机制

通过 `resource-roots.json` 持久化多个资源根目录配置，`ResourceRootsService` 提供 CRUD 并在变更时广播 `resource.updated` 事件。所有文件操作都通过 `safeJoin` 做路径安全校验，防止路径穿越。

系统启动时 `AppUpdateService.onModuleInit` 会幂等注册内置根 `{ id: 'software-update', path: 'software-update' }`（与 `storage` 同级），用于存放各应用的 APK 包，结构为 `software-update/[appKey]/v{versionCode}_{versionName}.apk`。

### 文件索引同步

```
┌────────────────────────────────────────────────────┐
│  应用启动 (onApplicationBootstrap)                   │
│  定时任务 (setInterval 5min)                         │
│  事件触发 (@OnEvent 'resource.updated')              │
│          ↓                                          │
│  FileIndexService.syncAll()                         │
│    ├─ 清理孤立数据（不属于活跃根目录的条目）          │
│    ├─ 逐根目录 syncRoot()                           │
│    │   ├─ 按 rootId 全量删除后重建                   │
│    │   ├─ 读取分类子目录                              │
│    │   ├─ 递归遍历 → FileRecord[]                    │
│    │   └─ 批量 upsert（500 条/批）                   │
│    └─ 完成                                          │
└────────────────────────────────────────────────────┘
```

### 图片处理缓存

```
请求 → 计算 cacheKey (SHA-1 of path|width|height|quality|format)
     → 检查 {FILE_ROOT}/.cache/thumbnails/{cacheKey}.{format}
        ├─ 命中 → 直接返回磁盘缓存
        └─ 未命中 → Sharp 处理 → 写入缓存 → 返回
```

### APP 更新检查与灰度

```
客户端上报 versionCode
    ↓
findLatestVisible (status ∈ [灰度, 全量], 按 versionCode 倒序)
    ├─ 若是灰度版本且 deviceId 未命中灰度分桶 → 回退到最大全量版本
    ↓
服务端 versionCode <= 客户端 versionCode → { hasUpdate: false }
    ↓
返回 { hasUpdate, appKey, versionCode, versionName, updateType,
       forceUpdate, downloadUrl, packageSize, checksum, updateLog, publishTime }
```

灰度命中：`sha256(deviceId)` 取前 8 位十六进制转整数对 100 取模，小于 `grayPercent` 即命中（同一设备结果稳定）。强更判定：`forceUpdate === 1` 或客户端 `versionCode < minVersionCode`。

### SPA 回退中间件

`main.ts` 中注册了一个 Express 中间件：

- 无文件扩展名 **且** 非 `/static` `/docs` 路径 **且** Accept 包含 `text/html` 的 GET 请求 → 返回 `index.html`
- 其他请求正常处理

前端静态目录为进程工作目录下的 `web/`（部署包即 `deploy/web/`）。

---

## 部署

### 一键打包

```bash
pnpm run deploy
```

执行 `script/deploy.js`，依次：

1. 清理并初始化 `deploy/` 目录
2. 构建 `@vakao/shared`
3. 构建后端 NestJS → `packages/backend/dist`，移动到 `deploy/server/`
4. 构建前端 Vite（`VITE_API_BASE_URL=origin`）→ `packages/frontend/dist`，移动到 `deploy/web/`
5. 复制 `@vakao/shared` 编译产物到 `deploy/server/shared/`（供部署 package.json 以 `file:` 引用）
6. 若根目录存在 `.env` 则拷贝到 `deploy/`（缺失时仅告警，继续使用默认值或系统环境变量）
7. 生成部署用 `package.json`（从 backend 依赖派生，`@vakao/shared` 改为 `file:./server/shared`）
8. 生成启动入口 `start-app.js`（chdir 到 deploy 目录后启动 `server/main.js`）
9. 生成 `start.sh`、`install.sh` 并自动赋予可执行权限

### 部署结构

```
deploy/
├── server/            # 后端编译产物 (NestJS)
│   └── shared/        # @vakao/shared 编译产物（file: 引用）
├── web/               # 前端静态资源 (Vue + Vite)
├── package.json       # 精简的生产依赖
├── start-app.js       # Node 启动入口
├── start.sh           # 启动脚本
├── install.sh         # 安装脚本（pnpm/yarn/npm）
└── .env               # 环境变量（从根目录 .env 拷贝，可能不存在）
```

### 部署步骤

```bash
# 1. 在项目根目录打包
pnpm run deploy

# 2. 将 deploy/ 目录上传到服务器
scp -r deploy/ user@server:/opt/vakao-static-hub/

# 3. 在服务器上
cd /opt/vakao-static-hub
./install.sh

# 4. 配置环境变量（编辑 .env 或导出）
# AUTH_USER=xxx AUTH_PASS=xxx JWT_SECRET=xxx

# 5. 启动
./start.sh
# 或 npm start
```

生产模式下，NestJS 自动挂载 `deploy/web/` 下的前端静态资源并提供 SPA fallback，前后端同源部署，无需额外配置 CORS 反向代理。

### 数据库初始化与同步

模板没有 TypeORM migration 框架，也没有版本化迁移文件。**schema 的唯一来源是实体定义**，唯一的数据库脚本是 `pnpm db:sync`。

**本地开发：`DB_SYNCHRONIZE` 控制启动时是否同步**

| 取值 | 行为 |
|------|------|
| `true`（推荐） | 启动时按实体自动建表/改表并播种默认管理员；改完实体直接重启即可生效 |
| `false`（未配置时的默认值） | 启动完全不碰结构，只校验核心表可读；空库或结构不一致会启动失败并提示 `pnpm db:sync` |

**生产部署：只用 `pnpm db:sync` 建库与改库**

```bash
# 首次部署：空库建表 + 播种管理员
pnpm db:sync

# 后续实体变更：同一脚本对齐结构（加列/改列/建索引）
pnpm db:sync
```

- 空库：建出全部表与索引，打印表清单和管理员账号
- 已有表但结构落后：按实体差异同步结构，打印「新建/变更/删除」摘要
- 结构已一致：打印「无需变更」，不产生任何 DDL
- 可重复执行；管理员播种仅在 `users` 表为空时进行
- 生产启动会忽略 `DB_SYNCHRONIZE`（若显式设为 `true` 会打印警告），只做连接与核心表校验
- 生产启动时数据库文件缺失或核心表不可用时，直接失败并提示执行 `pnpm db:sync`
- 数据库文件路径可用 `DB_PATH` 覆盖，默认 `<cwd>/storage/vakao.db`

> 模板不提供「数据库升级/迁移」概念：结构差异始终由同一个脚本按实体同步。使用方对数据库的后续改造自行负责。

**回滚候选过滤规则：** 只有 `status=PUBLISHED` 或 `status=OFFLINE AND offlineReason='auto'` 的版本可作为 rollback 恢复目标。`offlineReason` 为 NULL 的历史版本不作为回滚候选——它们被下架后无法通过 rollback 恢复。

---

## 开发命令

| 命令                  | 说明                                           |
| --------------------- | ---------------------------------------------- |
| `pnpm install`        | 安装所有依赖                                   |
| `pnpm dev`            | 构建 shared 后并行启动 shared/backend/frontend |
| `pnpm dev:backend`    | 启动后端（开发热重载）                         |
| `pnpm dev:frontend`   | 启动前端（开发热重载）                         |
| `pnpm build`          | 按 shared → backend → frontend 顺序构建        |
| `pnpm build:shared`   | 仅构建共享类型包                               |
| `pnpm build:backend`  | 仅构建后端                                     |
| `pnpm build:frontend` | 仅构建前端                                     |
| `pnpm db:sync`        | 按实体同步数据库结构并播种（生产建库/改库唯一入口） |
| `pnpm typecheck`      | 全仓类型检查（`pnpm -r typecheck`）            |
| `pnpm lint`           | 全仓 ESLint 校验                               |
| `pnpm format`         | Prettier 格式化                                |
| `pnpm deploy`         | 一键打包部署                                   |
