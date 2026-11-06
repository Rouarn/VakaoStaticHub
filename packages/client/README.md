# Vakao Static Hub — 前端

<p align="center">
  <img src="./public/intro.svg" width="300" height="155" alt="Vakao Static Hub Logo" />
</p>

基于 **Vue 3** + **Vite** + **NaiveUI** 的静态资源管理系统前端，提供文件库、分类与多根目录管理、上传、文件分享、随机图片、占位图生成、一言服务、APP 在线更新管理、存储统计、重复文件检测、审计日志、系统状态与用户管理。

> 后端说明：参见 [../../README.md](../../README.md)

---

## 技术栈

| 类别     | 技术                                           | 说明                                                                    |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| 框架     | Vue 3.5 + Composition API                      | `<script setup>` 语法                                                   |
| 构建     | Vite 8（Rolldown）                             | HMR + Rolldown 底层                                                     |
| UI 组件  | NaiveUI 2                                      | 组件由 unplugin-vue-components + NaiveUiResolver 自动按需导入           |
| 状态管理 | Pinia 3 + pinia-plugin-persistedstate          | 认证状态持久化到 localStorage（key `auth`）                             |
| 路由     | Vue Router                                     | 路由守卫 + 认证拦截                                                     |
| HTTP     | `@vakao-ui/axios`（封装于 `src/utils/http.ts`） | 自动附带 Token、解包 `{ code, message, data }` 统一信封、401 跳登录     |
| CSS      | UnoCSS + 设计令牌                              | 原子化 CSS，NaiveUI ConfigProvider 统一暗色模式                         |
| 图标     | @vicons/ionicons5                              | 侧边栏与操作图标                                                        |
| 日期工具 | dayjs                                          | 格式化时间戳                                                            |
| 二维码   | qrcode                                         | 分享链接二维码                                                          |
| 文件预览 | 独立预览组件 + `utils/preview-registry.ts`     | 见「文件预览架构」章节                                                  |
| 共享类型 | @vakao/shared                                  | monorepo 内部包，前后端共用模型（`ApiResponse`、`ShareLink` 等）        |
| 自动导入 | unplugin-auto-import + unplugin-vue-components | Vue / Router / Pinia API 自动导入                                       |
| 类型     | TypeScript + vue-tsc                           | 全量类型覆盖                                                            |
| 代码高亮 | highlight.js                                   | 文本 / Markdown 预览内联使用                                            |

---

## 快速开始

```bash
# 1. 在 monorepo 根目录安装依赖
pnpm bootstrap

# 2. 启动 Go 服务端（首次启动会按 AUTH_USER / AUTH_PASS 播种管理员）
pnpm dev:server

# 3. 另开终端启动前端（端口 9867，HMR）
pnpm dev:client

# 或一键同时启动
pnpm dev
```

开发服务器运行在 `http://localhost:9867`，Vite 把 `/api` 代理到后端 `http://localhost:9865`。开发环境 `VITE_API_BASE_URL` 留空，请求走相对路径代理，避免跨域。

### 后端与数据

Go 服务端启动时会自动执行内嵌的 SQLite 迁移，无需额外的建库脚本。数据库默认位于 `<BASE_DIR>/data/vakao.db`，资源与缓存目录也由 `FILE_ROOT` / `CACHE_DIR` 等环境变量控制；完整列表见根目录 README。

---

## 目录结构

```
packages/client/
├── index.html                      # HTML 入口
├── vite.config.ts                  # 别名、代理、自动导入、构建分包
├── uno.config.ts                   # UnoCSS 预设
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── .env.example / .env.development / .env.production
├── public/
│   ├── intro.svg                   # Logo
│   ├── favicon.ico
│   └── cmaps/                      # PDF.js CJK 字符映射表（169 个 .bcmap）
└── src/
    ├── main.ts                     # 应用入口：Pinia + Router + ConfigProvider + providers
    ├── App.vue                     # 根组件：NaiveUI ConfigProvider + 暗色模式
    ├── router/
    │   ├── index.ts                # 路由实例 + 守卫注册
    │   ├── routes.ts               # 路由表（public 路由 + DefaultLayout 子路由）
    │   └── guard.ts                # 鉴权守卫、登录重定向、redirect 回跳
    ├── layouts/
    │   ├── default-layout.vue      # 主布局：System Sidebar + Category Panel + Content
    │   └── components/
    │       ├── system-sidebar.vue  # 纯图标侧边栏 + Tooltip + tools 二级菜单
    │       └── category-panel.vue  # 240px 分类面板：根目录/分类 CRUD、计数、目录管理弹窗
    ├── views/
    │   ├── login/index.vue         # 登录页（用户名/密码，redirect 回跳）
    │   ├── files/
    │   │   ├── index.vue           # 文件库：网格/列表、搜索、排序、分页、多选批量
    │   │   └── components/
    │   │       ├── file-card.vue       # 文件卡片：缩略图、名称、大小、更多菜单
    │   │       ├── upload-panel.vue    # 上传面板：先选后传队列 + 拖拽/文件夹 + 分片续传
    │   │       ├── quick-share-modal.vue # 单文件/多选快速创建分享
    │   │       ├── rename-file-modal.vue
    │   │       └── move-file-modal.vue
    │   ├── shares/
    │   │   ├── index.vue           # 分享管理：筛选、列表、编辑、撤销、访问记录、二维码
    │   │   └── components/share-qr-modal.vue
    │   ├── share-access/index.vue  # 公开分享访问页：密码门、单文件/集合列表、逐项预览
    │   ├── file-preview/index.vue  # 独立文件预览页（公开，URL 参数指定文件）
    │   ├── app-update/
    │   │   ├── index.vue           # APP 更新管理：应用与版本列表、发布、回滚、强更、下架
    │   │   └── stats.vue           # 升级漏斗统计
    │   ├── storage-stats/index.vue # 按根目录/分类聚合的存储用量
    │   ├── duplicate-files/index.vue # 内容哈希分组的重复文件清理
    │   ├── audit-logs/index.vue    # 操作审计日志筛选与详情
    │   ├── system-status/index.vue # QPS / 内存 / 存储 / 分享 / 版本 / 24h 升级事件
    │   ├── users/index.vue         # 用户列表、创建、角色、重置密码、删除
    │   └── tools/
    │       ├── placeholder/index.vue # 占位图生成器
    │       └── hitokoto/index.vue    # 一言
    ├── components/
    │   ├── preview/
    │   │   ├── preview-dialog.vue    # 通用预览弹窗（卡片与分享页共用）
    │   │   ├── image-preview.vue / video-preview.vue / audio-preview.vue
    │   │   ├── text-preview.vue / markdown-preview.vue / html-preview.vue
    │   │   ├── pdf-preview.vue / word-preview.vue / excel-preview.vue
    │   │   ├── archive-preview.vue / default-preview.vue
    │   │   ├── fetch-text.ts         # 文本/Markdown 统一取文本（带鉴权/分享 accessToken）
    │   │   └── types.ts              # PreviewRegistration / PreviewLoader 类型
    │   ├── charts/
    │   │   ├── bar-list.vue          # 横向条形图（漏斗/用量）
    │   │   └── donut-chart.vue       # 环形图（占比）
    │   └── common/
    │       ├── confirm-modal.vue / page-header.vue
    │       ├── empty-state.vue / error-state.vue / placeholder-view.vue
    │       ├── public-page.vue       # 公开页外壳（分享访问/独立预览）
    │       └── stat-card.vue         # 指标卡片
    ├── composables/
    │   └── use-video-poster.ts       # 视频封面帧提取（预览占位）
    ├── config/
    │   ├── design-tokens.ts          # 颜色/圆角/间距令牌
    │   └── naive-theme.ts            # NaiveUI 主题覆盖
    ├── api/
    │   ├── auth.ts                   # 登录/注册/资料/改密/登出
    │   ├── files.ts                  # 文件 CRUD、分类、批量、分片上传、索引同步、统计、重复检测
    │   ├── roots.ts                  # 根目录列表/新增/更新/删除
    │   ├── shares.ts                 # 分享列表/创建/编辑/撤销/访问日志/公开信息/解锁/集合
    │   ├── app-update.ts             # 应用/版本/发布/回滚/客户端检查下载上报/漏斗统计
    │   ├── audit-logs.ts / metrics.ts / users.ts
    │   ├── placeholder.ts / hitokoto.ts
    ├── stores/modules/
    │   ├── auth.ts                   # accessToken / user / 持久化 / clearAuth
    │   ├── app.ts                    # activeRootId 等全局 UI 状态
    │   └── category.ts               # 根目录列表、分类列表与计数缓存
    ├── utils/
    │   ├── http.ts                   # 请求客户端：baseURL、Token、401 处理
    │   ├── file-url.ts               # **URL 唯一构造函数**：直链/缩略图/预览页/分享页/分享文件
    │   ├── preview-registry.ts       # **预览分发唯一配置点**
    │   ├── file-types.ts             # 扩展名/类型判断与大小格式化
    │   ├── format.ts / hljs.ts
    │   └── (typings) env.d.ts / auto-imports.d.ts / components.d.ts / shims-vue.d.ts
    └── typings/
        ├── auto-imports.d.ts         # unplugin-auto-import 生成
        ├── components.d.ts           # unplugin-vue-components 生成
        ├── env.d.ts / shims-vue.d.ts
```

---

## 路由表

| 路径                  | 页面         | 需要认证 | 说明                                                      |
| --------------------- | ------------ | -------- | --------------------------------------------------------- |
| `/login`              | 登录         | 否       | 用户名/密码登录，支持 `redirect` 参数回跳                 |
| `/share/:token`       | 分享访问     | 否       | 公开页：密码门、单文件访问或集合列表，支持逐项预览/下载   |
| `/file-preview`       | 文件预览     | 否       | 通过 query（rootId/category/path）打开独立预览            |
| `/`                   | 重定向       | -        | 跳转 `/files`                                             |
| `/files`              | 文件库       | 是       | 网格/列表、上传、批量、重命名/移动、快速分享              |
| `/shares`             | 分享管理     | 是       | 分享列表、筛选、编辑、撤销、访问记录、二维码              |
| `/app-update`         | APP 版本     | 是       | 应用与版本管理、发布、灰度、回滚、强更、下架              |
| `/app-update/stats`   | 升级漏斗     | 是       | check → download → install 转化率                         |
| `/storage-stats`      | 存储统计     | 是       | 按根目录/分类聚合用量                                    |
| `/duplicate-files`    | 重复文件     | 是       | 按内容哈希分组清理                                        |
| `/users`              | 用户管理     | 是       | 列表、创建、角色、重置密码、删除                          |
| `/audit-logs`         | 审计日志     | 是       | 动作/资源/用户/时间筛选                                   |
| `/system-status`      | 系统状态     | 是       | QPS、内存、存储、分享、版本、24h 升级事件                 |
| `/tools/placeholder`  | 占位图生成   | 是       | 可视化配置 + 实时预览                                     |
| `/tools/hitokoto`     | 一言         | 是       | 随机短句展示                                              |
| `/:pathMatch(.*)*`    | 404 兜底     | -        | 重定向 `/files`                                           |

侧边栏只展示 `meta.sidebar: true` 的路由（纯图标 + Tooltip）；`meta.categoryPanel: true` 的路由（当前为 `/files`）才会在布局中渲染第二个分类面板。

---

## 认证机制

```
用户访问 → router.beforeEach
               │
    ┌──────────┴──────────┐
    │ 目标页 meta.public？ │
    ├── true → 直接进入
    │
    └── false → authStore.isLoggedIn？
         ├── 是 → 正常进入
         └── 否 → 跳转 /login?redirect=原路径
```

- Token 与用户信息经 `pinia-plugin-persistedstate` 持久化到 `localStorage`（key `auth`），刷新后自动恢复。
- `src/utils/http.ts` 请求时自动附 `Authorization: Bearer <token>`；业务 `401` 清空登录态并跳登录（修改密码接口的 401 视为表单错误，不踢出登录）。

---

## 核心功能

### 1. 文件库与分类 / 多根目录

- **双视图**：网格（文件卡片）与列表；分页（默认 24 条/页）、关键词搜索、按名称/大小/修改时间排序。
- **分类面板**（`layouts/components/category-panel.vue`）：根目录选择、分类列表与计数、新建/重命名/删除分类（非空删除需勾选递归）。
- **根目录管理**：面板内「管理根目录」弹窗支持新增、编辑（名称/路径）、删除；数据接口：
  - `GET /v1/roots` 列表
  - `POST /v1/roots` 新增
  - `PATCH /v1/roots/:id` 更新
  - `DELETE /v1/roots/:id` 删除
  - `GET /v1/roots/browse` 服务器目录浏览（用于选择路径）
- **文件操作**：预览、下载、图片缩放（w/h/q/format）、重命名、移动到其他分类、批量删除、批量移动、快速创建分享。
- **URL 构造**：所有直链、缩略图、预览页、分享页地址统一经 `utils/file-url.ts`，保证 `/v1` 只出现一次。

### 2. 上传（先选后传 + 拖拽）

- **先选后传**：文件先进入待上传队列（`queued`），展示目标根目录/分类与大小；点击「开始上传」才真正发请求。可在队列中取消、失败重试。
- **拖拽与文件夹**：上传面板支持拖拽多文件/文件夹，文件夹通过 `webkitGetAsEntry` 递归读取并保留目录结构。
- **分片与续传**：单文件 > 5MB 自动切 5MB 分片，并发 3；`upload/init` 返回已上传分片列表用于断点续传；合并时校验 SHA-256。
- **落点锁定**：任务入队时锁定目标根/分类，上传中途切换目录不会造成落点漂移。
- **取消语义**：取消会中止在途请求并调用 `upload/cancel` 清理临时分片目录，不伪造成功。

接口：`POST /v1/files/upload`（multipart 多文件）、`POST /v1/uploads` + `PUT /v1/uploads/:id/chunks/:index` + `POST /v1/uploads/:id/complete` + `DELETE /v1/uploads/:id`（分片）。

### 3. 文件分享

- **分享数据模型**：分享只存一个字段 `filePaths: string[]`（分类内相对路径，1~N 个）；`shareType` 不落库，由 `filePaths.length` 派生：`1` → `file`，`>1` → `collection`。
- **创建入口**：
  - 文件卡片「更多」→「新建分享」：弹窗预填目标分类与文件名，可设有效期、最大访问次数、是否「需要密码」。
  - 文件库多选 → 批量条「创建分享（N 个文件）」：一次创建集合分享。
  - 分享管理页「创建分享」：选择根目录/分类后勾选文件创建。
- **校验**：未选文件、勾选「需要密码」但密码为空、自定义有效期为空/非正数都会被前端拦截并给出明确提示。
- **访问**：公开页 `/share/:token`；设密码时先 `POST /v1/s/:token/unlock` 换取访问令牌，再 `GET /v1/s/:token/f?accessToken=` 读取集合、`GET /v1/s/:token/f/:index` 读取单个文件；下载追加 `download=1`。
- **管理**：列表筛选、复制链接/二维码、编辑（备注/有效期/密码/次数/启停）、撤销、访问记录。
- **批量管理**：卡片内联选择框 + 工具条「全选当前页 / 取消全选」+「已选 N 项 / 本页 M 项」计数；选中后出现批量操作条（批量启用 / 批量停用 / 批量删除）。
  - 选中语义只作用于**当前页**：翻页、筛选、修改每页条数都会清空选择，避免误以为选中了全部。
  - 批量删除走二次确认，明确删除数量与「物理删除、不可恢复」。
  - 后端没有批量接口：前端 `api/shares.ts` 的 `batchShareAction()` 限并发（4）复用 `PATCH /v1/shares/:token`（启停）与 `DELETE /v1/shares/:token`（删除），逐条收集结果。部分失败会弹出结果面板，给出成功/失败条数与每个失败项的原因；仍在当前页的失败项保持选中便于重试，已不存在的项明确标注无法重试。

### 4. 文件预览

- 卡片弹窗与分享访问页共用 `components/preview/preview-dialog.vue`，分发逻辑统一在 `utils/preview-registry.ts`。
- 支持格式：图片、视频、音频、文本/代码、Markdown、HTML（sandbox iframe）、PDF、Word、Excel、压缩包（引导下载）；未命中走 `default-preview.vue`。
- 所有预览组件通过 `() => import()` 懒加载，并按需空闲预取。

### 5. APP 在线更新管理

- 应用（appKey）创建/重命名/删除（重命名与删除需输入包含 appKey 的确认短语）。
- 版本：上传 APK（ZIP 魔数校验 + 流式 SHA-256）→ DRAFT；发布门禁 versionCode 必须递增；全量/灰度（指定百分比或自动递增，到 100% 自动转全量）；定时发布；一键回滚只恢复被新全量挤掉的历史版本；远程强更；一键下架。
- 客户端检查 `GET /v1/a/:appKey/update`，下载 `GET /v1/a/versions/:id/download` 支持 Range。
- 升级漏斗看板：check / download / install_success / install_fail。

### 6. 其它页面

- **存储统计**：按根目录/分类聚合占用与文件数，进度条可视化。
- **重复文件**：按 `contentHash`（SHA-256）分组，手动选择保留项并删除其余。
- **审计日志**：登录/登出/改密、文件 CRUD、分享操作、APP 发布/回滚等异步落库，可按动作/资源/用户/时间筛选。
- **系统状态**：运行时长、60s QPS、内存、存储、活跃分享、版本分布、24h 升级事件，30 秒自动刷新。
- **用户管理**：列表、创建、角色、重置密码、删除（禁止删除自己且至少保留一个管理员）。
- **工具**：占位图生成（SVG 参数 + 多格式导出/复制）、一言（经后端代理）。

---

## 文件预览架构

`src/utils/preview-registry.ts` 是唯一配置点：按扩展名注册「懒加载组件」，`resolvePreview(filename)` 未命中返回 `null` 时调用方降级到默认视图。

| 组件（`src/components/preview/`） | 依赖库                      | 说明                                      |
| --------------------------------- | --------------------------- | ----------------------------------------- |
| `image-preview.vue`               | —                           | 图片（含 SVG/ICO/TIFF 等）                |
| `video-preview.vue`               | video.js                    | 视频流式预览（Range 边下边播）            |
| `audio-preview.vue`               | 原生 `<audio>`              | 音频流式预览                              |
| `text-preview.vue`                | highlight.js                | 纯文本 / 代码高亮                         |
| `markdown-preview.vue`            | markdown-it + highlight.js  | Markdown（禁用 HTML 渲染防 XSS）          |
| `html-preview.vue`                | 原生 iframe                 | HTML（sandbox 源隔离）                    |
| `pdf-preview.vue`                 | pdfjs-dist                  | PDF（`public/cmaps` 按需加载 CJK 映射）   |
| `word-preview.vue`                | docx-preview                | Word 文档                                 |
| `excel-preview.vue`               | xlsx（SheetJS）             | Excel / CSV（剥离 `<a>` 防 XSS）          |
| `archive-preview.vue`             | —                           | 压缩包引导下载                            |
| `default-preview.vue`             | —                           | 不支持格式统一引导下载                    |

**分发流程**：文件名 → 扩展名 → registry 命中 → `() => import()` 懒加载 → 渲染；卡片弹窗与 `/file-preview`、分享页复用同一套组件与 `fetch-text.ts`（统一处理鉴权 / 分享 accessToken）。

---

## 构建与分包策略

```bash
cd packages/client
pnpm typecheck   # vue-tsc
pnpm build       # vue-tsc + vite build
pnpm preview
```

`vite.config.ts` 的 `manualChunks` 只对入口静态依赖做固定分包：

| chunk 名          | 包含内容                                   | 说明                                                         |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `rolldown-runtime`| `vite/preload-helper` / modulepreload-polyfill / Vue export-helper | 必须固定，否则 preload 助手会被并入懒加载 chunk，导致首屏白屏 |
| `naive-ui`        | NaiveUI                                    | 入口静态依赖                                                 |
| `vue-vendor`      | Vue / Vue Router / Pinia                   | 入口静态依赖                                                 |
| `utils-vendor`    | axios / dayjs                              | 入口静态依赖                                                 |
| `icons-vendor`    | @iconify / @vicons                         | 入口静态依赖                                                 |
| 默认分包          | 其余 node_modules 与业务源码                | 预览库（video.js / pdfjs-dist / xlsx / docx-preview / highlight.js / markdown-it）**不设固定名**，保持懒加载语义 |

- 路由与预览组件均使用 `() => import()`，按页面/格式拆分 chunk。
- `chunkSizeWarningLimit: 1500`（pdfjs-dist 懒加载 chunk 约 1MB）。
- 产物命名：JS `assets/js/[name]-[hash].js`，其他资源 `assets/[ext]/[name]-[hash].[ext]`。

### 一体化部署

根目录 `pnpm build` 会依次构建 shared、Go 服务端与前端（前端使用 `.env.production` 中的 `VITE_API_BASE_URL=origin`）。把 `packages/client/dist` 放到 `WEB_DIR` 指向的目录，再由 Go 服务端同源托管并提供 SPA fallback，无需独立前端服务器。

---

## 环境变量

| 变量                    | 开发默认值            | 说明                                                        |
| ----------------------- | --------------------- | ----------------------------------------------------------- |
| `VITE_API_BASE_URL`     | 空                    | 空 → 相对路径走 Vite 代理；`origin` → 当前站点域名；也可填后端绝对地址 |

`src/utils/file-url.ts` 是 URL 的唯一构造入口：`getApiOrigin()` 会剥离末尾 `/v1` 后统一拼一次，避免出现 `/v1/v1/...`。

---

## 开发约定

- **组件/API 自动导入**：NaiveUI 组件按需自动注册；Vue / Router / Pinia API 自动导入。
- **路由组件懒加载**：页面与预览组件均 `() => import()`。
- **别名**：`@` → `src/`，`@vakao/shared` → `../shared/src/`。
- **样式**：UnoCSS 原子类 + 设计令牌，不新增独立样式文件。
- **状态**：认证 → `stores/modules/auth.ts`；根目录/分类缓存 → `stores/modules/category.ts`；全局 UI → `stores/modules/app.ts`。
- **预览组件**：统一放 `components/preview/`，命名 `*-preview.vue`，只在 `utils/preview-registry.ts` 注册。
- **XSS 防护**：表格剥离 `<a>`、Markdown 禁用 HTML、HTML 预览 sandbox iframe。
