# 本地开发

[← 返回索引](../README.md)

## 技术栈

| 层级     | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 后端     | Go 1.27 + 标准库 `net/http`                                       |
| 数据库   | SQLite（`modernc.org/sqlite`，WAL 模式，迁移随二进制内嵌）        |
| 图片处理 | `disintegration/imaging` + `nativewebp`                           |
| 认证     | JWT（HS256）+ scrypt 密码哈希                                     |
| 日志     | 标准库 `log/slog`                                                 |
| 前端     | Vue 3.5 + Vite 8 + NaiveUI + Pinia + TypeScript（见 [客户端 README](../packages/client/README.md)）|
| 共享类型 | `@vakao/shared`（monorepo 内部包）                                |
| 包管理   | pnpm >= 10.15.0（workspace monorepo，`nodeLinker: hoisted`）      |

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

变量含义见 [配置说明](./configuration.md)。

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
│   │       ├── sharelink/      # 分享地址签名与访问令牌
│   │       ├── cdn/            # EdgeOne 缓存刷新（可选）
│   │       ├── office/         # LibreOffice 转 PDF
│   │       ├── appupdate/      # APP 更新领域逻辑
│   │       ├── auth/           # JWT 与密码哈希
│   │       ├── storage/        # 路径安全与解析
│   │       ├── roots/          # 资源根目录
│   │       ├── files/          # 文件操作
│   │       ├── model/          # 领域模型
│   │       ├── sysinfo/        # 进程指标
│   │       └── config/         # 环境变量与 .env 解析
│   └── client/                 # @vakao/client：Vue 3 + Vite 前端
├── docs/                       # 项目文档（本目录）
├── data/                       # 运行时数据（不入库）
├── legacy-data/                # 旧后端数据快照（可选，不入库）
├── resource-roots.json         # 开发用根目录播种样例（可选、不入库、不进发布包）
├── .env.example                # 配置模板（入库）
└── .env                        # 本地真实配置（不入库）
```

## 本地构建产物

```bash
pnpm build
```

- 后端：`packages/server/bin/vakao-server`
- 前端：`packages/client/dist`

前后端同源运行时，把前端产物放到 `WEB_DIR` 指向的目录即可，服务端会托管静态资源并提供 SPA fallback：

```bash
BASE_DIR=/opt/vakao WEB_DIR=/opt/vakao/web ./packages/server/bin/vakao-server
```

项目不包含 Docker / 容器化配置。生产环境打包、部署与升级见 [部署](./deployment.md)。
