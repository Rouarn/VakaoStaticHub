# 部署

[← 返回索引](../README.md)

## 打包

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

发布包**有意不包含 `resource-roots.json`**。该文件只在空库首次启动时用于播种根目录，缺失时服务端会回退到内置的 `default` 与 `software-update`，因此不影响运行；若把开发机上的版本打进包里，反而会把线上根目录指向开发机的路径（详见 [resource-roots.json](./resource-roots.md)）。

构建顺序为 shared → client → server → 组装 → tar.gz；任一步失败立即中止并保留原始错误。缺少 `go`、`pnpm`、`node` 或 `tar` 时会输出明确的中文提示。打包结束时终端会打印初始管理员账号、初始密码与发布包路径。

## 服务器启动

包内 `.env` 已可用，无需复制或编辑：

```bash
tar -xzf vakao-static-hub-<version>-linux-amd64.tar.gz
cd vakao-static-hub-<version>-linux-amd64
chmod +x vakao-server
./vakao-server
```

初始管理员为 `admin`，密码见打包终端输出或包内 `.env` 的 `AUTH_PASS`。该密码仅用于首次启动播种管理员，登录后请立即修改。默认以当前目录为基准目录，读取 `web/`、写入 `data/`，监听 `0.0.0.0:9865`。

宝塔面板可在「进程守护管理器」中添加守护进程：运行目录填解包目录，启动命令填 `./vakao-server`，运行用户建议 `www`，并放行 9865 端口（或由 Nginx 反向代理）。

### 以 `www` 身份手动重启

宝塔的启动脚本只负责拉起、不负责杀旧进程，直接启动会出现端口被占用。稳妥做法是先停旧进程再以 `www` 身份启动：

```bash
APP=/www/wwwroot/vakao-static-hub
OLD=$(ss -lptn 'sport = :9865' | grep -o 'pid=[0-9]*' | cut -d= -f2)
[ -n "$OLD" ] && kill "$OLD" && sleep 3 && (ps -p "$OLD" >/dev/null && kill -9 "$OLD")
su -s /bin/bash www -c "cd $APP && nohup ./vakao-server >> /www/wwwlogs/go/VakaoStaticHub.log 2>&1 &"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9865/healthz
```

`healthz` 返回 `200` 才算启动成功。

## 升级

只替换 `vakao-server` 与 `web/`，默认不要覆盖线上已有的 `.env`：重新打包会生成新的 `JWT_SECRET`，覆盖会让所有已登录会话失效；`AUTH_PASS` 变化也不会修改已存在管理员的密码（播种只在首次启动执行一次）。包内 `README.md` 含完整部署、升级与配置说明。

建议每次替换前把旧二进制与前端目录备份到同级目录（例如 `/www/wwwroot/vakao-static-hub-backup-<时间戳>/`），出问题可直接回滚。

## Nginx 反向代理：`/v1` 必须绕过 proxy_cache

宝塔「反向代理」模板默认在 `/www/server/nginx/conf/proxy.conf` 开启 `proxy_cache cache_one`，会在 CDN 之下再缓一层。分享文件带 `public, max-age=604800`，一旦被 nginx 缓存，撤销分享后 CDN 刷新回源仍会拿到旧的 `200`，刷新等于没生效。

在站点配置 `/www/server/panel/vhost/nginx/<站点>.conf` 的 `location /` 里加上这四行（放在 `proxy_pass` 之前）：

```nginx
set $skip_cache 0;
if ($request_uri ~ ^/v1/) { set $skip_cache 1; }
proxy_cache_bypass $skip_cache;
proxy_no_cache $skip_cache;
```

然后 `nginx -t && nginx -s reload`。

验证：删除一个已访问过的分享（确保它进过 CDN 缓存），再请求原地址。若 Go 端日志出现该请求，说明确实回源了；若 nginx 访问日志有 `200/206` 而应用日志没有任何记录，说明仍在吃 nginx 缓存，检查上面四行是否生效。

## 生产环境检查项

- `JWT_SECRET`、`SHARE_SIGN_KEY` 必须显式设置为足够长的随机值（各 ≥16 字节），不要沿用示例占位值
- 首次部署后立即修改初始管理员密码
- 反向代理后按需设置 `TRUST_PROXY=true`；前端独立域名访问 API 时配置 `CORS_ORIGIN`
- 需要撤销分享即时生效时，配置 `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` / `EDGEONE_ZONE_ID`，见 [缓存机制](./cache.md)
