# 配置说明（环境变量）

[← 返回索引](../README.md)

配置从进程环境变量读取，可选 `.env` 文件作为回退。逐项的用途、格式示例与取值来源见根目录 [.env.example](../.env.example)。

## 服务与认证

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
| `SHARE_SIGN_KEY` | 无（必填）         | 公开分享文件地址的签名密钥，至少 16 字节；换掉即作废旧地址  |
| `TENCENTCLOUD_SECRET_ID` | -        | 撤销分享时刷新 CDN 缓存的 SecretId；留空则不刷新            |
| `TENCENTCLOUD_SECRET_KEY` | -       | 同上，SecretKey；三项齐全才启用刷新                         |
| `EDGEONE_ZONE_ID` | -                 | EdgeOne 站点 ID；三项齐全才启用刷新                          |

缓存相关的行为与取舍（分享文件 7 天、Office 转换缓存位置、刷新失败处理）见 [缓存机制](./cache.md)。

## 存储与数据库

| 变量                  | 默认值                    | 说明                                     |
| --------------------- | ------------------------- | ---------------------------------------- |
| `DB_PATH`             | `<BASE_DIR>/data/vakao.db` | SQLite 数据库路径                       |
| `FILE_ROOT`           | `<BASE_DIR>/data`         | 默认资源根目录                           |
| `RESOURCE_ROOTS_FILE` | `<BASE_DIR>/resource-roots.json` | 可选：空库首启时的根目录播种文件，运行期不再读取（见 [resource-roots.json](./resource-roots.md)） |
| `UPLOAD_TEMP_DIR`     | `<BASE_DIR>/data/.uploads` | 分片上传临时目录                        |
| `CACHE_DIR`           | `<BASE_DIR>/data/.cache`  | 缩略图缓存目录                           |
| `WEB_DIR`             | `<BASE_DIR>/web`          | 前端构建产物目录；目录缺失时仅暴露 API   |

## 上传与图片

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

## Office 预览

| 变量                    | 默认值      | 说明                                 |
| ----------------------- | ----------- | ------------------------------------ |
| `OFFICE_CONVERT_CONCURRENCY` | `2`    | Office 转 PDF 并发数                 |
| `OFFICE_CONVERT_TIMEOUT` | `90s`      | 单次转换超时                         |
| `OFFICE_MAX_INPUT_MB`   | `20`        | 单个文件转换上限（MB），超限返回 422 |
| `OFFICE_CACHE_DIR`      | 系统临时目录下的 `vakao-static-hub-office` | 转换缓存目录 |
| `SOFFICE_PATH`          | `soffice`   | LibreOffice 可执行文件路径           |

`OFFICE_CACHE_DIR` 为什么放在系统临时目录、为什么没有保留期与容量上限，见 [缓存机制](./cache.md)。

## 外部服务

| 变量                  | 默认值 | 说明                                                         |
| --------------------- | ------ | ------------------------------------------------------------ |
| `HITOKOTO_API_URL`    | -      | 一言服务地址，页面通过运行时配置获取后直连；留空则页面禁用一言 |
| `APP_PUBLIC_BASE_URL` | -      | 安装包下载链接外部基址；留空按请求头动态拼接                 |
