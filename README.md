# Vakao Static Hub

<p align="center">
  <img src="./packages/client/public/intro.svg" width="300" height="155" alt="Vakao Static Hub Logo" />
</p>

基于 **Go 1.27** + **Vue 3** 的静态资源管理系统，采用 pnpm monorepo（`packages/shared` / `packages/server` / `packages/client`）。提供多根目录文件管理、随机图片服务、占位图生成、一言代理、文件分享链接和 APP 在线更新中心等能力。

> 前端文档：参见 [packages/client/README.md](./packages/client/README.md)

---

## 核心特性

- **多根目录管理**：根目录持久化在数据库（`resource_roots` 表），支持动态增删与服务器目录浏览（仅枚举目录、受安全边界限制）；首次启动且空库时可由可选的 `resource-roots.json` 播种（见 [`resource-roots.json`（可选，仅用于首次播种）](#resource-rootsjson可选仅用于首次播种)）
- **文件管理**：上传、删除、重命名、分页浏览、关键词搜索、多字段排序（名称 / 大小 / 修改时间）；支持批量删除、批量移动分类
- **大文件上传**：multipart 多文件流式落盘；大于 5MB 的文件走分片上传，支持断点续传，合并时校验 SHA-256
- **重复文件检测**：`file_entries` 记录内容 SHA-256，按哈希分组找出重复副本，前端可视化对比与清理
- **存储用量统计**：按根目录 / 分类聚合占用空间与文件数
- **文件索引**：SQLite 持久化索引，启动时全量扫描，之后按 `CACHE_REFRESH_INTERVAL_MS` 定时刷新
- **图片处理**：生成缩略图（默认 JPEG，可显式请求 WebP），限制最大像素数与边长，磁盘缓存
- **随机图片服务**：按根目录 / 分类 / 尺寸组合查询
- **占位图生成**：SVG 占位图动态生成，支持尺寸、颜色、文字、字体、字重自定义，带 ETag 协商缓存
- **一言代理**：反向代理 `hitokoto` 服务，响应原样转发
- **文件分享链接**：单文件 / 多文件聚合分享，可设有效期、最大访问次数与访问密码（scrypt 哈希 + HMAC 短期访问令牌），访问记录持久化（IP / UA / 时间），支持撤销
- **APP 在线更新中心**：多应用（appKey）独立版本管理，安装包自动计算 SHA-256，草稿 / 灰度 / 全量 / 下架四态，灰度按设备哈希稳定分桶，定时发布，一键回滚，强更开关与最低兼容版本，下载支持 HTTP Range，升级事件上报与漏斗统计
- **操作审计日志**：登录、上传、删除、发布、分享等关键操作持久化到 `audit_logs`
- **监控指标**：运行时、数据库、存储、分享、应用版本与 24h 升级事件
- **安全加固**：JWT 鉴权、scrypt 密码哈希、登录 / 分享解锁速率限制、可配置 CORS
- **SPA 托管**：配置 `WEB_DIR` 后由 Go 服务端直接托管前端构建产物并提供 fallback

---

## 技术栈

| 层级     | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 后端     | Go 1.27 + 标准库 `net/http`                                       |
| 数据库   | SQLite（`modernc.org/sqlite`，WAL 模式，迁移随二进制内嵌）        |
| 图片处理 | `disintegration/imaging` + `nativewebp`                           |
| 认证     | JWT（HS256）+ scrypt 密码哈希                                     |
| 日志     | 标准库 `log/slog`                                                 |
| 前端     | Vue 3.5 + Vite 8 + NaiveUI + Pinia + TypeScript（见客户端 README）|
| 共享类型 | `@vakao/shared`（monorepo 内部包）                                |
| 包管理   | pnpm >= 10.15.0（workspace monorepo，`nodeLinker: hoisted`）      |

---

## 快速开始

```bash
# 1. 安装依赖
pnpm bootstrap

# 2. 准备环境变量（至少修改 JWT_SECRET）
cp .env.example .env

# 3. 一键启动：Go 服务端 + Vite 开发服务器
pnpm dev
```

默认端口：

| 服务     | 地址                                | 说明                                   |
| -------- | ----------------------------------- | -------------------------------------- |
| 后端 API | http://localhost:9865               | 业务接口前缀 `/v1`                     |
| 前端     | http://localhost:9867               | Vite 开发服务器，`/v1` 反向代理到后端  |
| 健康检查 | http://localhost:9865/healthz       | 返回存活状态                           |

首次启动时若 `users` 表为空且 `AUTH_PASS` 非空，会播种 `AUTH_USER` / `AUTH_PASS` 指定的管理员；`AUTH_PASS` 留空则不播种。`JWT_SECRET` 必填且长度不少于 16 字节。

---

## 根目录命令

所有命令都在仓库根目录执行。

| 命令                 | 说明                                                     |
| -------------------- | -------------------------------------------------------- |
| `pnpm bootstrap`     | 安装 workspace 依赖，并预下载 Go modules                 |
| `pnpm dev`           | 构建 shared 后并行启动 Go 服务端与 Vite 前端             |
| `pnpm dev:server`    | 仅启动 Go 服务端（`BASE_DIR` 指向仓库根目录）            |
| `pnpm dev:client`    | 仅启动 Vite 开发服务器                                   |
| `pnpm build`         | 依次构建 shared、Go 二进制、前端静态产物                 |
| `pnpm build:shared`  | 仅构建 `@vakao/shared`                                   |
| `pnpm build:server`  | 编译 `packages/server/bin/vakao-server`                  |
| `pnpm build:client`  | 构建前端到 `packages/client/dist`                        |
| `pnpm package`       | 打包前端与静态编译的后端到 `release/`（tar.gz）          |
| `pnpm start`         | 运行已编译的 Go 二进制（需先 `pnpm build`）              |
| `pnpm typecheck`     | shared + client 的 TypeScript 类型检查                   |
| `pnpm test`          | `go test ./...`                                          |
| `pnpm vet`           | `go vet ./...`                                           |
| `pnpm lint`          | eslint（shared + client）                                |
| `pnpm format`        | prettier 与 gofmt 格式化                                 |
| `pnpm format:check`  | 格式检查，未格式化时非零退出                             |

---

## 打包与部署

生成可直接上传服务器的发布包，不需要 Docker，也不需要 Node 运行时：

```bash
# 默认版本取根 package.json 的 version，目标 linux/amd64
pnpm package

# 指定目标平台与版本号
pnpm package --goos linux --goarch arm64 --version 1.2.3
```

产物位于 `release/vakao-static-hub-<version>-<goos>-<goarch>/` 及同名 `.tar.gz`。`release/` 已加入 `.gitignore`，不同版本目录可以并存；同名目录或压缩包已存在时脚本会中止，不会覆盖。

包内包含：

- `vakao-server`：`CGO_ENABLED=0` 交叉编译，`-trimpath -ldflags "-s -w"`，版本号通过 `-X main.version` 写入
- `web/`：前端构建产物
- `data/`：空数据目录
- `.env`：打包时生成的真实配置，含随机的 `JWT_SECRET`（32 字节）与初始管理员密码，其余配置项显式写全，权限 `600`，解包即用
- `.env.example`：配置模板，只含键名、含义与推荐值，不含真实密钥
- `README.md`：部署与启动说明

发布包**有意不包含 `resource-roots.json`**。该文件只在空库首次启动时用于播种根目录，缺失时服务端会回退到内置的 `default` 与 `software-update`，因此不影响运行；若把开发机上的版本打进包里，反而会把线上根目录指向开发机的路径。

构建顺序为 shared → client → server → 组装 → tar.gz；任一步失败立即中止并保留原始错误。缺少 `go`、`pnpm`、`node` 或 `tar` 时会输出明确的中文提示。打包结束时终端会打印初始管理员账号、初始密码与发布包路径。

服务器上的启动步骤（包内 `.env` 已可用，无需复制或编辑）：

```bash
tar -xzf vakao-static-hub-<version>-linux-amd64.tar.gz
cd vakao-static-hub-<version>-linux-amd64
chmod +x vakao-server
./vakao-server
```

初始管理员为 `admin`，密码见打包终端输出或包内 `.env` 的 `AUTH_PASS`。该密码仅用于首次启动播种管理员，登录后请立即修改。默认以当前目录为基准目录，读取 `web/`、写入 `data/`，监听 `0.0.0.0:9865`。宝塔面板可在「进程守护管理器」中添加守护进程：运行目录填解包目录，启动命令填 `./vakao-server`，运行用户建议 `www`，并放行 9865 端口（或由 Nginx 反向代理）。

升级时只替换 `vakao-server` 与 `web/`，默认不要覆盖线上已有的 `.env`：重新打包会生成新的 `JWT_SECRET`，覆盖会让所有已登录会话失效；`AUTH_PASS` 变化也不会修改已存在管理员的密码（播种只在首次启动执行一次）。包内 `README.md` 含完整部署、升级与配置说明。

---

## 环境变量

配置从进程环境变量读取，可选 `.env` 文件作为回退。可参考根目录 [.env.example](./.env.example)。

### 服务与认证

| 变量             | 默认值             | 说明                                                        |
| ---------------- | ------------------ | ----------------------------------------------------------- |
| `HOST`           | `0.0.0.0`          | 监听地址                                                    |
| `PORT`           | `9865`             | 监听端口                                                    |
| `BASE_DIR`       | 进程工作目录       | 运行期基准目录，所有相对路径基于它解析                      |
| `CORS_ORIGIN`    | `''`               | 跨域来源白名单，逗号分隔；留空不开放跨域                    |
| `TRUST_PROXY`    | `false`            | 位于可信反向代理后时设为 `true`，才会采用 `X-Forwarded-*`   |
| `LOG_LEVEL`      | `info`             | `debug` / `info` / `warn` / `error`                         |
| `AUTH_USER`      | `admin`            | 首次启动播种的管理员用户名                                  |
| `AUTH_PASS`      | `''`               | 首次启动播种的管理员密码；留空则不播种                      |
| `JWT_SECRET`     | 无（必填）         | JWT 签名密钥，至少 16 字节且不能为默认占位值                |
| `JWT_EXPIRES_IN` | `12h`              | Token 有效期                                                |

### 存储与数据库

| 变量                  | 默认值                    | 说明                                     |
| --------------------- | ------------------------- | ---------------------------------------- |
| `DB_PATH`             | `<BASE_DIR>/data/vakao.db` | SQLite 数据库路径                       |
| `FILE_ROOT`           | `<BASE_DIR>/data`         | 默认资源根目录                           |
| `RESOURCE_ROOTS_FILE` | `<BASE_DIR>/resource-roots.json` | 可选：空库首启时的根目录播种文件，运行期不再读取          |
| `UPLOAD_TEMP_DIR`     | `<BASE_DIR>/data/.uploads` | 分片上传临时目录                        |
| `CACHE_DIR`           | `<BASE_DIR>/data/.cache`  | 缩略图缓存目录                           |
| `WEB_DIR`             | `<BASE_DIR>/web`          | 前端构建产物目录；目录缺失时仅暴露 API   |

### 上传与图片

| 变量                    | 默认值      | 说明                                 |
| ----------------------- | ----------- | ------------------------------------ |
| `UPLOAD_MAX_COUNT`      | `20`        | 单次 multipart 上传最大文件数        |
| `DEFAULT_CATEGORY`      | `TemporaryFile` | 默认分类目录名                   |
| `CHUNK_FILE_SIZE_LIMIT` | `104857600` | 单个分片硬上限（字节，默认 100MB）   |
| `MAX_IMAGE_PIXELS`      | `60000000`  | 缩略图允许解码的最大像素数           |
| `MAX_IMAGE_DIMENSION`   | `4096`      | 缩略图最大边长                       |
| `THUMB_CONCURRENCY`     | `2`         | 缩略图生成并发度                     |
| `THUMB_CACHE_RETENTION_DAYS` | `30`   | 缩略图缓存保留天数，0 表示不按时间清理 |
| `THUMB_CACHE_MAX_MB`    | `512`       | 缩略图缓存总容量上限（MB），0 表示不限 |
| `CLEANUP_AT`            | `03:00`     | 每日清理时刻（缩略图缓存与过期分享） |
| `CACHE_REFRESH_INTERVAL_MS` | `300000` | 索引刷新间隔（毫秒）                |
| `ROOT_BROWSE_WHITELIST` | `''`        | 目录浏览额外允许的绝对路径，逗号分隔 |

### 外部服务

| 变量                  | 默认值                                          | 说明                                       |
| --------------------- | ----------------------------------------------- | ------------------------------------------ |
| `HITOKOTO_API_URL`    | `https://static.shixian.xyz/static/hitokoto`    | 一言代理目标，留空则禁用                   |
| `APP_PUBLIC_BASE_URL` | -                                               | 安装包下载链接外部基址；留空按请求头动态拼接 |

---

### `resource-roots.json`（可选，仅用于首次播种）

这个文件**只有一个用途**：服务首次启动、且数据库根目录表为空时，用来播种根目录。它不是运行期配置，也不是根目录的唯一来源——根目录的真正来源是数据库。

- **何时读**：启动时先查 `resource_roots` 表。只有表为空（全新库）才去读 `<BASE_DIR>/resource-roots.json`；表里已有根目录则直接跳过，连文件都不会打开。
- **读到什么**：按 JSON 数组逐项创建根目录（`id`、`name`、`path`、`description`），同时创建对应目录。`path` 为相对路径时按 `BASE_DIR` 解析，绝对路径原样使用；`id` 或 `path` 为空的条目会被跳过。
- **读不到怎么办**：文件不存在时使用代码内置的两个根：`default`（`FILE_ROOT`）与 `software-update`（`FILE_ROOT/software-update`），所以该文件是可选的。文件存在但不是合法 JSON 数组时启动直接失败（不会静默忽略），删掉该文件即可恢复默认播种。
- **之后会不会再读**：不会。播种只在空库时发生一次，后续启动不再读取；页面上的根目录增删改只写数据库，**不会回写**这个文件。
- **删了会怎样**：首次启动完成后可以安全删除，不影响正常运行；只有把数据库清空重来（例如删除 `data/vakao.db`）才会再次需要它。
- **仓库根目录那份**：`./resource-roots.json` 是本地开发用的播种样例（默认根指向 `legacy-data/`），不入库、不打进发布包。发布包 `.env` 里仍保留 `RESOURCE_ROOTS_FILE=resource-roots.json` 这一项，但因为包内没有该文件，线上首启走的是内置默认值。

---

## 目录结构

```
vakao-static-hub/
├── packages/
│   ├── shared/                 # @vakao/shared：前后端共享类型
│   ├── server/                 # Go 服务端
│   │   ├── cmd/server/         # 服务入口
│   │   └── internal/
│   │       ├── httpapi/        # 路由、中间件、处理函数、HTTP 契约
│   │       ├── store/          # SQLite 访问层与内嵌迁移
│   │       ├── indexer/        # 文件索引扫描
│   │       ├── upload/         # 分片上传会话
│   │       ├── media/          # 缩略图生成
│   │       ├── sharelink/      # 分享访问令牌
│   │       ├── appupdate/      # APP 更新领域逻辑
│   │       ├── auth/           # JWT 与密码哈希
│   │       ├── storage/        # 路径安全与解析
│   │       ├── roots/          # 资源根目录
│   │       ├── files/          # 文件操作
│   │       ├── model/          # 领域模型
│   │       ├── sysinfo/        # 进程指标
│   │       └── config/         # 环境变量与 .env 解析
│   └── client/                 # @vakao/client：Vue 3 + Vite 前端
├── data/                       # 运行时数据（不入库）
├── legacy-data/                # 旧后端数据快照（可选，不入库）
├── resource-roots.json         # 开发用根目录播种样例（可选、不入库、不进发布包）
├── .env.example                # 配置模板（入库）
└── .env                        # 本地真实配置（不入库）
```

---

## API 概览

- 基础路径 `/v1`；所有 JSON 响应统一为 `{"code":200,"message":"ok","data":...}`，列表分页结构位于 `data` 内：`{"items":[],"total":n,"page":p,"pageSize":s}`
- 错误使用同一外层信封：`code` 为 HTTP 状态码、`message` 为错误说明、`data` 为 `null`
- 文件流、图片、安装包下载、占位图与 SPA 静态资源直接返回原始字节，不使用信封；其错误仍为 JSON 信封
- 鉴权使用 `Authorization: Bearer <token>`，由 `POST /v1/auth/login` 签发
- 时间为 RFC 3339；数据库内部使用 Unix 毫秒
- 文件内容端点公开（面板直接使用 `<img>`），分享链接由访问令牌保护
- 完整路由表以 [contract.go](./packages/server/internal/httpapi/contract.go) 为准，不提供 Swagger

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

---

## 数据库

- 数据库使用 SQLite WAL 模式，迁移文件内嵌在二进制中，启动时自动执行
- 旧 NestJS 后端已移除，其最后状态保存在 Git 标签 `archive/nestjs-backend`
- 旧数据快照保留在仓库根 `legacy-data/`（已 gitignore，仅作备份）

---

## 构建与部署

```bash
pnpm build
```

产物：

- 后端：`packages/server/bin/vakao-server`
- 前端：`packages/client/dist`

前后端同源部署时，将前端产物放到 `WEB_DIR` 指向的目录，服务端会托管静态资源并提供 SPA fallback：

```bash
BASE_DIR=/opt/vakao WEB_DIR=/opt/vakao/web ./packages/server/bin/vakao-server
```

项目不包含 Docker / 容器化配置。生产环境请显式设置 `JWT_SECRET`、`AUTH_PASS`，并按需配置 `CORS_ORIGIN` 与 `TRUST_PROXY`。
