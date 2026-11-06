# Vakao Static Hub 部署说明

本发布包内含静态编译的 `vakao-server` 与前端产物 `web/`，解包即可运行，不需要 Docker，也不需要安装 Node.js。

## 目录结构

```
vakao-static-hub-<version>-<goos>-<goarch>/
├── vakao-server     # 服务端二进制（静态编译，无外部依赖）
├── web/             # 前端构建产物，由服务端同源托管
├── data/            # 运行时数据：SQLite 数据库、缩略图缓存、上传文件
├── .env             # 打包时生成的真实配置（含随机 JWT_SECRET 与初始管理员密码，权限 600）
├── .env.example     # 配置模板（只有键名、含义与推荐值，不含真实密钥）
└── README.md        # 本文件
```

解包位置建议固定，例如 `/www/wwwroot/vakao-static-hub`。服务端以进程工作目录为基准目录，`data/`、`web/` 等相对路径都相对解包目录解析。

## `.env` 与 `.env.example` 的关系

- **首次部署**：直接使用包内 `.env`，不需要复制、不需要手工编辑。其中的 `JWT_SECRET`、`AUTH_PASS` 是打包时随机生成的，其余配置项均已显式写全。
- **`.env.example`**：仅作为键名与推荐值的参考，不参与运行。不要用它覆盖已存在的 `.env`。
- 打包结束时终端会打印初始管理员账号与初始密码，二者也写在包内 `.env` 的 `AUTH_USER` / `AUTH_PASS` 中。
- `.env` 含明文密钥，权限为 `600`，请勿提交到版本库或随意外发。

## 第一次启动

```bash
cd /www/wwwroot/vakao-static-hub
chmod +x vakao-server        # 打包时已带执行权限，视解压工具而定
./vakao-server
```

默认监听 `0.0.0.0:9865`，托管 `web/` 下的前端，数据写入 `data/`。

首次启动且 `users` 表为空时，会用 `.env` 中的 `AUTH_PASS` 播种管理员（用户名 `AUTH_USER`，默认 `admin`）。**播种只发生一次**，之后修改 `.env` 里的 `AUTH_PASS` 不会改变已存在账号的密码。

> 初始密码仅用于首次启动播种管理员，登录后请立即修改。

## 健康检查

```bash
curl -s http://127.0.0.1:9865/healthz
```

返回 JSON 中的 `data.version` 应与包名中的版本号一致。注意路径是 `/healthz`，不是 `/v1/healthz`（后者不存在）。

## 日志

- 服务端日志通过 `slog` 输出到标准输出（stdout/stderr），不单独写文件。
- 使用宝塔「进程守护管理器」时，守护进程会收集标准输出，在守护进程的日志页面查看。
- 自行以 nohup 或 systemd 启动时，请重定向到文件，例如：

```bash
mkdir -p logs
nohup ./vakao-server >> logs/server.log 2>&1 &
```

- 日志详细程度由 `.env` 的 `LOG_LEVEL` 控制：`debug` / `info` / `warn` / `error`。

## 宝塔面板进程守护

1. 将解包目录放到站点目录，例如 `/www/wwwroot/vakao-static-hub`。
2. 确保运行用户对目录有读写权限，尤其是 `data/`：

```bash
chown -R www:www /www/wwwroot/vakao-static-hub
chmod +x /www/wwwroot/vakao-static-hub/vakao-server
```

3. 在宝塔「软件商店」安装「进程守护管理器」，添加守护进程：
   - 名称：`vakao-static-hub`
   - 启动用户：`www`
   - 运行目录：`/www/wwwroot/vakao-static-hub`
   - 启动命令：`./vakao-server`
   - 进程数量：`1`
4. 放行 `9865` 端口；如使用 Nginx 反向代理，可将站点代理到 `http://127.0.0.1:9865`，并保留 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto` 请求头（同时在 `.env` 中设置 `TRUST_PROXY=true`）。

## 升级

1. 在「进程守护管理器」中停止旧进程。
2. 备份 `data/` 与 `.env`。
3. **只替换 `vakao-server` 与 `web/`**（`README.md` 可一并替换），不要覆盖 `data/` 与 `.env`。
4. 重新启动守护进程，访问 `/healthz` 确认版本号已更新。

**默认不要覆盖线上已有的 `.env`。** 每次打包都会生成新的 `JWT_SECRET` 与 `AUTH_PASS`，直接覆盖会带来：

- `JWT_SECRET` 变化：**所有已登录会话立即失效**，所有人需要重新登录。
- `AUTH_PASS` 变化：**不会修改已存在管理员的密码**（播种只在 `users` 表为空时执行一次），因此"密码被重置了"的预期会落空，登录仍使用旧密码。
- 新版本若新增配置键，请对照新包 `.env.example`/`.env` 手动补到线上 `.env` 中，而不是整体覆盖。

是否改用新包的 `.env`，由使用者自行决定；如确需更换，请先评估上述影响。

## `resource-roots.json`（可选，仅用于首次播种）

发布包内**不包含** `resource-roots.json`，这是有意的，不影响运行。需要手工维护时，按下面几点判断：

- **唯一用途**：服务首次启动、且数据库根目录表（`resource_roots`）为空时，用这个文件播种根目录列表。它不是运行期配置。
- **放哪里**：`RESOURCE_ROOTS_FILE` 指定的路径，默认 `<BASE_DIR>/resource-roots.json`（`BASE_DIR` 默认是运行目录，即解包目录）。相对路径按 `BASE_DIR` 解析，绝对路径原样使用；条目里的 `path` 同理。
- **没有这个文件**：使用服务内置的两个根目录 `default`（`FILE_ROOT`，默认 `data`）与 `software-update`（`FILE_ROOT/software-update`），所以它是可选的。文件存在但不是合法 JSON 数组时启动会失败，删掉文件即可恢复默认播种。
- **只读一次**：播种只在空库时发生；之后每次启动，只要数据库里已有根目录就不再读取该文件。页面上的根目录增删改只写数据库，**不会回写**该文件。
- **可以删**：首次启动完成后可随时删除，不影响正常运行；只有清空数据库重来（例如删除 `data/vakao.db`）才会再次用到它。

## 修改密码与新增用户

- **修改自己的密码**：登录后进入「用户」页面修改当前账号密码（对应接口 `PATCH /v1/auth/password`）。
- **新增用户 / 重置他人密码 / 删除用户**：管理员登录后在「用户」页面操作（对应接口 `POST /v1/users`、`PATCH /v1/users/{id}/password`、`DELETE /v1/users/{id}`）。
- **忘记管理员密码**：没有内置找回流程。可先备份后删除 `data/vakao.db` 让服务重新播种管理员，但这会丢失索引、分享、审计等数据库记录（磁盘上的文件不会删除），请谨慎操作。

## `.env` 键名说明

以下只说明键名与含义，不包含真实取值。新版本新增的键会在新包的 `.env` 中出现。

| 键名 | 含义 |
| --- | --- |
| `HOST` | 监听地址 |
| `PORT` | 监听端口 |
| `BASE_DIR` | 运行期基准目录，所有相对路径基于它解析 |
| `AUTH_USER` | 首次启动播种的管理员用户名 |
| `AUTH_PASS` | 首次启动播种的管理员密码；已存在管理员时不再生效 |
| `JWT_SECRET` | JWT 签名密钥，泄露等同于会话可被伪造 |
| `JWT_EXPIRES_IN` | 登录令牌有效期 |
| `CORS_ORIGIN` | 跨域来源白名单，逗号分隔；留空不开放跨域 |
| `TRUST_PROXY` | 是否采用反向代理传来的 `X-Forwarded-*` 头 |
| `DB_PATH` | SQLite 数据库文件路径 |
| `FILE_ROOT` | 默认资源根目录 |
| `RESOURCE_ROOTS_FILE` | 可选：空库首启时的根目录播种文件，运行期不再读取 |
| `UPLOAD_TEMP_DIR` | 分片上传临时目录 |
| `CACHE_DIR` | 缩略图缓存目录 |
| `WEB_DIR` | 前端构建产物目录 |
| `UPLOAD_MAX_COUNT` | 单次 multipart 上传的最大文件数 |
| `DEFAULT_CATEGORY` | 默认分类目录名 |
| `CHUNK_FILE_SIZE_LIMIT` | 单个分片大小硬上限（字节） |
| `MAX_IMAGE_PIXELS` | 缩略图允许解码的最大像素数 |
| `MAX_IMAGE_DIMENSION` | 缩略图最大边长 |
| `THUMB_CONCURRENCY` | 缩略图生成并发度 |
| `THUMB_CACHE_RETENTION_DAYS` | 缩略图缓存保留天数，`0` 表示不按时间清理 |
| `THUMB_CACHE_MAX_MB` | 缩略图缓存总容量上限（MB），`0` 表示不限 |
| `CLEANUP_AT` | 每日清理时刻（缩略图缓存与过期分享） |
| `CACHE_REFRESH_INTERVAL_MS` | 文件索引刷新间隔（毫秒） |
| `ROOT_BROWSE_WHITELIST` | 服务器目录浏览额外允许的绝对路径，逗号分隔 |
| `HITOKOTO_API_URL` | 一言代理目标地址；留空则禁用 |
| `APP_PUBLIC_BASE_URL` | 安装包下载链接的外部基址；留空按请求头拼接 |
| `LOG_LEVEL` | 日志级别：`debug` / `info` / `warn` / `error` |

## 常见问题

- **启动报端口占用**：改用 `PORT` 或释放 `9865` 端口。
- **无法写入数据**：确认运行用户对 `data/` 有写权限。
- **前端 404 或空白**：确认 `web/` 与 `vakao-server` 在同一层，且 `.env` 中 `WEB_DIR=web`。
- **登录 401 且提示令牌无效**：`.env` 的 `JWT_SECRET` 被更换过，重新登录即可。
