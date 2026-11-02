# Vakao Static Hub — 前端

<p align="center">
  <img src="./public/intro.svg" width="300" height="155" alt="Vakao Static Hub Logo" />
</p>

基于 **Vue 3** + **Vite** + **NaiveUI** 的静态资源管理系统前端，提供文件管理、随机图片浏览、占位图生成、一言服务、文件分享链接管理（含访问密码与访问记录）、APP 在线更新管理、存储统计、重复文件检测、用户管理等功能。

> 后端文档：参见 [../../README.md](../../README.md)

---

## 技术栈

| 类别     | 技术                                           | 说明                                                                    |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| 框架     | Vue 3.5 + Composition API                      | `<script setup>` 语法                                                   |
| 构建     | Vite 8（Rolldown）                             | 极速 HMR，Rolldown 底层                                                 |
| UI 组件  | NaiveUI 2                                      | 组件自动按需导入（unplugin-vue-components + NaiveUiResolver）           |
| 状态管理 | Pinia 3 + pinia-plugin-persistedstate          | 认证状态持久化到 localStorage                                           |
| 路由     | Vue Router 5                                   | 路由守卫 + 认证拦截                                                     |
| HTTP     | @vakao/axios                                   | 拦截器自动附加 Token、401 自动跳转登录                                  |
| CSS      | UnoCSS                                         | 原子化 CSS，通过 NaiveUI ConfigProvider 统一暗色模式切换                |
| 图标     | @vicons/ionicons5（IonIcons）                  | @iconify 动态按需解析                                                   |
| 日期工具 | dayjs                                          | 格式化时间戳                                                            |
| 二维码   | qrcode                                         | 分享链接二维码生成                                                      |
| 文件预览 | 多格式独立组件 + preview-registry.ts           | 见下方「文件预览架构」章节                                              |
| 共享类型 | @vakao/shared                                  | monorepo 内部包，与后端共用模型（ApiResponse、实体 DTO）                |
| 自动导入 | unplugin-auto-import + unplugin-vue-components | Vue / Vue Router / Pinia API 自动导入，NaiveUI 组件按需自动注册        |
| 类型     | TypeScript 6 + vue-tsc                         | 全量类型覆盖                                                            |
| 代码高亮 | highlight.js                                   | 代码/文本预览组件内联使用                                               |

---

## 文件预览架构（2026-11-01 重构）

2026-11-01 移除了原 jit-viewer（8MB）的统一预览方案，改为 **9 类独立预览组件**，统一收敛到 `src/utils/preview-registry.ts`：

| 组件文件                                                     | 依赖库                      | 说明                              |
| ------------------------------------------------------------ | --------------------------- | --------------------------------- |
| `file-list/components/pdf-file-preview.vue`                 | pdfjs-dist                  | PDF 预览（public/cmaps 169 个 CJK 字符映射表按需加载） |
| `file-list/components/docx-file-preview.vue`                | docx-preview                | Word 文档预览                     |
| `file-list/components/xlsx-file-preview.vue`                | xlsx（SheetJS）             | Excel / CSV 预览                  |
| `file-list/components/markdown-file-preview.vue`            | markdown-it + highlight.js  | Markdown 预览（禁用 HTML 渲染防 XSS） |
| `file-list/components/text-file-preview.vue`                | highlight.js                | 纯文本 / 代码高亮预览             |
| `file-list/components/html-file-preview.vue`                | 原生 iframe                 | HTML 文件预览（sandbox 属性源隔离） |
| `file-list/components/image-file-preview.vue`                | —                           | 图片预览                          |
| `file-list/components/video-file-preview.vue`                | video.js@^8                 | 视频流式预览（range 边下边播）    |
| `file-list/components/audio-file-preview.vue`                | 原生 `<audio>`              | 音频流式预览                      |
| `file-list/components/archive-file-preview.vue`             | —                           | 压缩包引导下载                     |
| `file-list/components/default-file-preview.vue`             | —                           | 不支持格式统一引导下载             |

**分发逻辑**：`preview-registry.ts` 内根据文件扩展名判断格式 → 懒加载对应组件（`() => import()` + requestIdleCallback 空闲预取）→ 卡片弹窗和独立预览页（file-viewer.vue）共用同一套分发。

**分包策略**：所有预览库（video.js / pdfjs-dist / xlsx / docx-preview / highlight.js / markdown-it）**都不设固定 chunk 名**，交给 Vite 默认分包保持懒加载语义。manualChunks 只对入口静态依赖的库做固定分包：

```ts
manualChunks(id) {
  // Rolldown 运行时助手必须固定，否则会把 Vite preload 函数合并进懒加载 chunk
  if (id.includes('vite/preload-helper') || ...) return 'rolldown-runtime';
  if (id.includes('naive-ui')) return 'naive-ui';
  if (id.includes('vue') || id.includes('vue-router') || id.includes('pinia')) return 'vue-vendor';
  if (id.includes('axios') || id.includes('dayjs')) return 'utils-vendor';
  if (id.includes('@iconify') || id.includes('@vicons')) return 'icons-vendor';
  // 其他（含全部预览库）→ 走默认分包，按需加载
}
```

**首屏体积**：gzip 约 200KB（Vue + NaiveUI 运行时）；完整依赖按需加载的总 gzip 体积约 450KB（远小于原 jit-viewer 的 2.8MB）。

**XSS 防护**：
- 表格预览剥离 `<a>` 标签
- Markdown 预览禁用 HTML 渲染
- HTML 预览使用带 `sandbox` 属性的 iframe 做源隔离

---

## 快速开始

```bash
# 在项目根目录（monorepo）
pnpm install

# 启动开发服务器（端口 9867，HMR）
pnpm dev:frontend

# 或在 frontend 包目录下
cd packages/frontend
pnpm dev
```

开发服务器默认运行在 `http://localhost:9867`，Vite 代理 `/static`（业务接口）与 `/docs`（Swagger 文档）到后端 `http://localhost:9865`。API 基础地址通过环境变量 `VITE_API_BASE_URL` 配置，开发环境留空以走相对路径代理。

---

## 目录结构

```
packages/frontend/
├── index.html                     # HTML 入口
├── vite.config.ts                 # Vite 配置（别名、分包、代理、自动导入）
├── uno.config.ts                  # UnoCSS 预设
├── tsconfig.json                  # TS 配置入口
├── tsconfig.app.json              # 应用 TS 配置（extends @vue/tsconfig/tsconfig.dom.json）
├── tsconfig.node.json             # Node 侧 TS 配置
├── package.json
├── .env.example
├── public/
│   ├── intro.svg                  # Logo
│   ├── favicon.ico
│   └── cmaps/                     # PDF.js CJK 字符映射表（169 个 .bcmap 文件）
└── src/
    ├── main.ts                    # 应用入口：Pinia + Router + NaiveUI ConfigProvider + NDialogProvider
    ├── App.vue                    # 根组件：ConfigProvider + 暗色模式切换
    ├── router/
    │   ├── index.ts               # 路由实例创建 + 注册守卫
    │   ├── routes.ts              # 路由表（builtinRoutes 公开页 + builtinChildren 主布局子路由）
    │   └── guard.ts               # 路由守卫：requiresAuth 检查、登录重定向、redirect 参数回跳
    ├── layouts/
    │   ├── base-layout.vue        # 主布局：Header + Sidebar + Content + Footer
    │   ├── blank-layout.vue       # 空白布局（独立预览页用）
    │   └── modules/
    │       ├── app-header.vue     # 顶部栏：Logo、刷新、上传、暗色切换、登出、用户菜单
    │       ├── app-sidebar.vue    # 侧边栏：灰色 group 小标题 + 二级可展开菜单
    │       ├── app-content.vue    # 内容区：RouterView 插槽 + NSpin 全局加载
    │       └── app-footer.vue     # 底部栏：版本信息
    ├── views/
    │   ├── login/
    │   │   └── index.vue          # 登录页：用户名/密码、redirect 参数回跳
    │   ├── file-list/
    │   │   ├── index.vue          # 文件列表页：网格/列表双视图、虚拟滚动、分页、搜索、排序
    │   │   ├── file-card.vue      # 文件卡片：缩略图、文件名、大小、操作
    │   │   └── components/        # 列表页子组件与弹窗
    │   │       ├── file-preview.vue           # 卡片弹窗内预览：分发到独立组件
    │   │       ├── default-file-preview.vue   # 不支持格式引导下载
    │   │       ├── image-file-preview.vue     # 图片预览
    │   │       ├── video-file-preview.vue     # video.js 视频流式预览
    │   │       ├── audio-file-preview.vue     # 原生 audio 流式预览
    │   │       ├── archive-file-preview.vue   # 压缩包引导下载
    │   │       ├── html-file-preview.vue      # sandbox iframe 预览
    │   │       ├── markdown-file-preview.vue  # markdown-it + highlight.js
    │   │       ├── text-file-preview.vue      # highlight.js 代码/文本
    │   │       ├── pdf-file-preview.vue       # pdfjs-dist
    │   │       ├── docx-file-preview.vue      # docx-preview
    │   │       ├── xlsx-file-preview.vue      # SheetJS
    │   │       ├── rename-file-modal.vue      # 重命名文件弹窗
    │   │       ├── rename-category-modal.vue  # 重命名分类弹窗
    │   │       ├── create-share-modal.vue     # 创建分享链接弹窗
    │   │       └── copy-link-modal.vue        # 复制分享链接弹窗
    │   ├── file-preview/
    │   │   ├── index.vue          # 文件预览独立页（/file-preview 和 /local-file-preview 共用）
    │   │   └── components/
    │   │       ├── url-input.vue       # URL 输入组件
    │   │       ├── file-viewer.vue     # 独立预览页的文件渲染器（复用 preview-registry 分发逻辑）
    │   │       ├── image-file-viewer.vue
    │   │       └── status-display.vue  # 状态提示（空/错误/不支持）
    │   ├── placeholder/
    │   │   └── index.vue          # 占位图生成器：可视化配置 + 实时预览
    │   ├── hitokoto/
    │   │   └── index.vue          # 一言：随机短句展示
    │   ├── api-docs/
    │   │   └── index.vue          # API 文档：iframe 嵌入 Swagger UI
    │   ├── share-links/
    │   │   └── index.vue          # 分享链接管理：列表、复制、撤销、访问记录
    │   ├── share-access/
    │   │   └── index.vue          # 公开分享访问页：密码校验、单文件/聚合文件列表
    │   ├── app-update/
    │   │   ├── index.vue          # APP 更新管理：应用与版本列表
    │   │   ├── stats.vue          # 升级漏斗统计：check/download/install 转化率
    │   │   ├── publish-modal.vue  # 发布（全量/灰度/自动递增/定时）弹窗
    │   │   ├── version-form-modal.vue # 上传 APK 新建版本弹窗
    │   │   └── app-action-modal.vue    # 应用重命名/删除（需输入包含 appKey 的确认短语）
    │   ├── storage-stats/
    │   │   └── index.vue          # 存储用量统计：按根目录/分类聚合的存储用量可视化
    │   ├── duplicate-files/
    │   │   └── index.vue          # 重复文件检测：按内容哈希分组展示重复副本并手动清理
    │   ├── audit-logs/
    │   │   └── index.vue          # 操作审计日志：按动作/资源/用户/时间筛选，查看操作详情
    │   ├── system-status/
    │   │   └── index.vue          # 系统状态：QPS、内存、存储、分享、版本、24h 升级事件
    │   └── user-management/
    │       ├── index.vue          # 用户管理：列表、删除（禁止删除自己）
    │       └── register.vue
    ├── components/
    │   ├── loading-screen.vue     # 全局加载屏
    │   ├── upload-modal.vue       # 上传弹窗：拖拽、文件夹上传、大文件自动分片、断点续传
    │   ├── root-management.vue    # 根目录管理：增删改、服务器目录浏览
    │   └── copyable-code.vue      # 可复制代码块
    ├── composables/
    │   ├── use-file-preview.ts    # 预览状态管理（文件类型 → 组件映射）
    │   ├── use-file-upload.ts     # 上传逻辑（含文件夹递归读取、大文件分片）
    │   ├── use-modal.ts           # 弹窗状态封装
    │   └── use-pagination.ts      # 分页逻辑
    ├── api/
    │   ├── auth.ts                # 认证 API：login / register / getProfile / logout / changePassword / listUsers / deleteUser
    │   ├── files.ts               # 文件 API：CRUD、上传（单段 + 分片）、根目录管理、重命名、同步、用量统计、重复检测
    │   ├── share.ts               # 分享链接 API
    │   ├── system.ts              # 审计日志 / 系统监控指标 API
    │   └── app-update.ts          # APP 更新 API：应用管理、版本管理、客户端检查/下载/上报、漏斗统计
    ├── utils/
    │   ├── env.ts                 # 环境变量工具：getApiBaseUrl()、getBaseUrl()
    │   ├── request.ts             # Axios 实例：baseURL、Token 注入、401 拦截自动清除 Token 并跳登录
    │   ├── file-types.ts          # 文件类型映射：扩展名 → 预览支持判断（isVideo / isPreviewable 等）
    │   ├── preview-registry.ts    # **预览组件统一分发点**：扩展名 → 懒加载组件 + requestIdleCallback 空闲预取
    │   ├── video-player-loader.ts # video.js 懒加载器（缓存 promise + requestIdleCallback 空闲预取）
    │   ├── hljs-theme.ts          # highlight.js 主题配置（适配暗色模式）
    │   ├── text-decode.ts         # 文本解码工具
    │   ├── format.ts              # 格式化工具（文件大小、时间戳）
    │   └── url.ts                 # URL 工具
    ├── stores/
    │   └── modules/
    │       ├── auth/index.ts      # 认证 Store：accessToken、isLoggedIn、持久化、clearAuth
    │       └── file-list/index.ts # 文件列表 Store：分页、视图模式、根目录/分类选择、defaultCategory
    └── typings/
        ├── auto-imports.d.ts      # unplugin-auto-import 自动生成
        ├── components.d.ts        # unplugin-vue-components 自动生成
        └── vite-env.d.ts          # Vite 环境变量类型
```

---

## 路由表

| 路径                     | 页面           | 需要认证 | 说明                                             |
| ------------------------ | -------------- | -------- | ------------------------------------------------ |
| `/login`                 | 登录页         | 否       | 用户名/密码登录或注册，支持 redirect 参数回跳    |
| `/file-preview`          | 文件预览       | 否       | 独立页面，输入 URL 预览文件（blank-layout）      |
| `/share/:token`          | 分享访问页     | 否       | 公开页面，密码校验、单文件下载或聚合文件列表     |
| `/`                      | 重定向         | -        | 自动跳转到 `/files`                              |
| `/files`                 | 文件库         | 是       | 文件浏览/上传/删除/重命名/搜索/排序/分享         |
| `/shares`                | 分享管理       | 是       | 分享链接列表、复制、撤销、访问记录               |
| `/api-docs`              | API 文档       | 是       | iframe 嵌入 `/docs` Swagger UI                   |
| `/tools/placeholder`     | 占位图生成器   | 是       | 可视化占位图配置工具                             |
| `/tools/hitokoto`        | 一言           | 是       | 随机短句展示                                     |
| `/app-update`            | APP 更新管理   | 是       | 应用与版本管理、发布、强更、下架、回滚           |
| `/app-update/stats`      | 升级漏斗统计   | 是       | 各版本 check/download/install 数量与转化率       |
| `/storage-stats`         | 存储统计       | 是       | 按根目录/分类聚合的存储用量可视化                |
| `/duplicate-files`       | 重复文件检测   | 是       | 按内容哈希分组展示重复副本并手动清理             |
| `/audit-logs`            | 操作审计日志   | 是       | 按动作/资源/用户/时间筛选，查看操作详情          |
| `/system-status`         | 系统状态       | 是       | QPS、内存、存储、分享、版本、24h 升级事件指标    |
| `/users`                 | 用户管理       | 是       | 用户列表与删除（禁止删除自己）                   |
| `/:pathMatch(.*)*`       | 404 兜底       | -        | 重定向到 `/files`                                |

---

## 认证机制

### 流程图

```
用户访问 → router.beforeEach
               │
    ┌──────────┴──────────┐
    │ 目标页 requiresAuth？ │
    ├── false（或未设）→ 直接进入
    │
    └── true → 已登录（authStore.isLoggedIn）？
         ├── 是 → 正常进入
         └── 否 → 跳转 /login?redirect=原路径
```

### 状态持久化

- 使用 Pinia + `pinia-plugin-persistedstate` 将 `accessToken` 持久化到 `localStorage`
- 页面刷新后自动恢复认证状态
- 登出 / 401 时清除 Token（`authStore.clearAuth()`）

### HTTP 拦截器（src/utils/request.ts）

- **请求拦截器**：自动为已登录请求附加 `Authorization: Bearer {token}`
- **响应拦截器**：捕获 `401` 状态码 → 调用 `authStore.clearAuth()` → 自动跳转 `/login?redirect=当前路径`

---

## 核心功能

### 1. 文件列表（主页面）

- **双视图模式**：网格视图（useVirtualList 虚拟滚动）和列表视图（NaiveUI DataTable + virtual-scroll）
- **分页浏览**：默认每页 100 条，支持页码跳转、每页数量切换
- **搜索过滤**：关键词搜索匹配文件名和路径（前后端双重过滤）
- **排序**：支持按名称、大小、修改时间排序，升序/降序切换
- **批量操作**：列表视图支持多选，批量删除、批量移动分类、批量创建聚合分享
- **文件操作**：
  - 预览：点击直接打开独立预览组件（preview-registry.ts 分发）
  - 下载：直接下载（带 Content-Disposition）
  - 图片缩放：可指定 w/h/q/format 参数经 Sharp 处理后返回（Cache-Control 一天）
  - 重命名：弹窗输入新文件名（validateBasename 只允许 basename，防路径穿越）
  - 创建分享链接：设置有效期、最大访问次数与可选 scrypt 访问密码

### 2. 文件上传

- **单段上传**：`POST /static/files/:rootId/upload`（ConfigurableFilesInterceptor，默认最多 20 文件）
- **大文件分片上传**（upload-modal.vue）：
  - `POST /static/files/upload/init` → 返回 uploadId（32 位十六进制 MD5）
  - `POST /static/files/upload/chunk?uploadId=&index=` 逐片上传（multer fileSize 硬上限 100MB/片）
  - `POST /static/files/upload/complete` → 合并 + SHA-256 校验 + 建立索引
  - `POST /static/files/upload/cancel` → 清理临时目录
  - 临时目录落在操作系统临时目录下的应用专属子目录（`os.tmpdir()/vakao-static-hub/uploads/{uploadId}/`）
- **断点续传**：init 时返回已上传分片列表，网络中断后从断点继续
- **文件夹上传**：自动递归读取、保留目录结构

### 3. 文件索引同步

- 后端 `FileIndexService` 在启动时、每 5 分钟、资源根目录变更时全量重建索引
- 重建流程：先在内存里准备好全部新记录 → 事务内 delete + 批量 upsert
- 哈希缓存：文件大小与修改时间均未变化时保留已有 SHA-256 哈希
- 并发安全：SQLite 写锁数据库级粒度，事务化保证 delete 和 insert 之间不会让并发查询看到空索引

### 4. 占位图生成器

- SVG 占位图动态生成（服务端），支持尺寸、颜色、文字、字体、字重自定义
- 多格式导出：URL、Markdown `![]()`、HTML `<img>`、MDX 代码片段
- 一键复制（CopyableCode 组件）

### 5. 一言

- 直接请求 `VITE_HITOKOTO_API_URL` 获取随机短句（不经过后端代理）
- 展示句子内容、分类标签、出处、作者
- 支持换一句刷新

### 6. 文件预览

- **双入口**：`/file-preview`（公开，blank-layout）和 `/local-file-preview`（需认证，base-layout）
- **预览组件分发**：`src/utils/preview-registry.ts` 唯一配置点
- **懒加载 + 空闲预取**：`() => import()` + requestIdleCallback
- **支持格式**（共 9 类独立实现）：

  | 类别   | 格式                                                     | 依赖库          |
  | ------ | -------------------------------------------------------- | --------------- |
  | 文档   | PDF、Word（docx）、Excel（xlsx/csv）、Markdown、TXT/代码 | pdfjs-dist / docx-preview / xlsx / markdown-it / highlight.js |
  | 图片   | 全部主流格式                                             | 原生 `<img>`    |
  | 视频   | mp4 / mov / webm / avi / mkv / ogv                       | video.js        |
  | 音频   | mp3 / wav / ogg 等                                       | 原生 `<audio>`  |
  | HTML   | .html / .htm 文件                                        | sandbox iframe  |

  PPT、OFD、DXF 等无内嵌实现的格式回退到下载引导。

### 7. API 文档

- 通过 `<iframe>` 嵌入后端 Swagger UI（`${baseURL}/docs`）
- 全屏展示，左侧导航栏可折叠

### 8. 分享链接管理

- **创建**：单文件或聚合（collection）分享，可设有效期、最大访问次数、scrypt 访问密码
- **解锁流程**：密码校验 → 通过后返回 30 分钟有效期的 HMAC 访问令牌 → 令牌过期或次数达上限后需重新解锁
- **列表**：token、类型、目标文件、有效期、访问次数、是否设密码
- **二维码**：分享页二维码一键生成（qrcode 库）
- **复制链接**：一键复制公开访问 URL（`{origin}/share/{token}`）与后端下载 API 地址（带 accessToken）

### 9. APP 在线更新管理

- **应用管理**：
  - `software-update` 根目录下每个 appKey 一个独立目录
  - 创建 / 重命名 / 删除（重命名和删除都需弹窗输入包含 appKey 的确认短语）
- **版本管理**：
  - 上传 APK → 自动校验 ZIP 魔数 → 流式计算 SHA-256 → 入库为 DRAFT
  - 发布门禁：versionCode 必须大于该应用当前全量版本；publishVersion 事务化 + SQLite 写锁防并发绕过门禁
  - 发布模式：全量 / 灰度（指定百分比或自动递增时间表 + 到 100% 自动转全量）
  - 定时发布：创建 DRAFT 时可设 `scheduledPublishAt`（后端每 10 分钟扫描到期）
  - 一键回滚 → 恢复上一个全量版本
  - 远程强更开关（逃生口）
  - 一键下架（止血开关，物理文件保留）
- **客户端检查**：`GET /static/app-updates/check?platform=&appKey=&versionCode=&deviceId=` 公开接口；灰度命中按 `sha256(deviceId)` 分桶（稳定）
- **下载**：`GET /static/app-updates/download/:id` 支持 HTTP Range 断点续传
- **漏斗统计**：check → download → install_success / install_fail 转化率看板

### 10. 存储用量统计

- 按根目录 / 分类聚合 file_entries 索引表
- 进度条可视化占比

### 11. 重复文件检测

- 按 `contentHash`（SHA-256）分组
- 大小相同才可能重复（先 `GROUP BY size HAVING COUNT(*) > 1` 缩小范围）
- 对缺少哈希的记录惰性补算并回写索引
- 支持手动选择保留哪个、删除其余

### 12. 操作审计日志

- 异步写入：登录 / 登出 / 注册 / 改密、文件 CRUD、分类重命名、分享链接操作、APP 管理/版本发布/下架/回滚/强更
- 中文标签展示（动作、资源类型），原始英文值保留在悬浮 tooltip
- 详情弹窗同时显示中文 + 原始值

### 13. 系统状态

- 进程运行时长、最近 60 秒 QPS、注册用户数
- 进程内存（RSS / 堆已用 / 堆总量 / External）
- 文件存储总量、各资源根用量、分享链接活跃情况、APP 版本状态分布
- 最近 24 小时升级事件（检查 / 下载 / 安装成功 / 安装失败）
- 30 秒自动刷新

### 14. 用户管理

- 查看所有注册用户（id、用户名、创建时间，不含密码哈希）
- 删除用户（当前登录用户按钮置灰）
- 修改密码：顶部用户菜单弹窗（后端校验 oldPassword）

---

## 暗色模式

使用 `@vueuse/core` 的 `useDark()`，切换存储在 `localStorage`，全局共享状态：

- `App.vue`：NaiveUI `NConfigProvider` 根据 `isDark` 切换 `darkTheme`
- `app-header.vue`：月亮/太阳图标切换按钮
- UnoCSS `dark:` 变体与 NaiveUI 主题变量配合

主题色：`#18a058`（NaiveUI 绿色主题）

---

## 环境变量

| 变量                    | 默认值 | 说明                                                                                |
| ----------------------- | ------ | ----------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`     | -      | 后端 API 地址（开发时通常是空字符串走相对路径代理；生产构建为 `"origin"` 即同源） |
| `VITE_HITOKOTO_API_URL` | -      | 一言 API 地址（一言页面直接 fetch 该地址，不经过后端代理）                          |

前端通过 `src/utils/env.ts` 解析：

- `getBaseUrl()`：返回 `VITE_API_BASE_URL`（`"origin"` 时替换为 `window.location.origin`）
- `getApiBaseUrl()`：返回 `${getBaseUrl()}/static`（所有后端业务接口前缀为 `/static`）

---

## 构建与部署

### 开发

```bash
cd packages/frontend
pnpm dev          # 启动 Vite 开发服务器 (端口 9867)
pnpm typecheck    # vue-tsc 类型检查
```

### 生产构建

```bash
cd packages/frontend
pnpm build        # vue-tsc 类型检查 + vite build
pnpm preview      # 预览构建产物
```

Vite 构建配置（packages/frontend/vite.config.ts）：

- **分包策略（manualChunks）**：
  | chunk 名       | 包含内容                              | 说明                                                     |
  | -------------- | ------------------------------------- | -------------------------------------------------------- |
  | `rolldown-runtime` | Vite preload-helper / Vue export-helper | Rolldown 运行时助手必须固定，否则会把 preload 函数合并进懒加载 chunk 导致首屏白屏 |
  | `vue-vendor`   | Vue / Vue Router / Pinia              | 入口静态依赖，固定分包                                    |
  | `naive-ui`     | NaiveUI 组件库                        | 入口静态依赖，固定分包                                    |
  | `utils-vendor` | axios / dayjs                         | 入口静态依赖，固定分包                                    |
  | `icons-vendor` | @iconify / @vicons                    | 入口静态依赖，固定分包                                    |
  | 默认分包        | 其他所有 node_modules + 项目源码      | 预览库（video.js / pdfjs-dist / xlsx / docx-preview / highlight.js / markdown-it 等）**不设固定 chunk 名**，交给 Rolldown 默认分包，保持懒加载语义 |
- **chunk 阈值**：1500KB（pdfjs-dist 懒加载 chunk 约 1MB，调高避免误报）
- **文件命名**：
  - JS chunk：`assets/js/[name]-[hash].js`
  - 其他资源：`assets/[ext]/[name]-[hash].[ext]`

### 一体化部署

参见根目录 [../../README.md](../../README.md) 部署章节。在根目录执行 `pnpm deploy` 会自动：

1. 构建 `@vakao/shared` 与后端
2. 以 `VITE_API_BASE_URL=origin` 构建前端
3. 将 `dist/` 移动到 `deploy/web/`
4. 后端 NestJS 启动时自动挂载为静态资源并提供 SPA fallback

生产模式下前端无需独立服务器，与后端同源部署。

---

## 开发约定

- **组件注册**：使用 `unplugin-vue-components` 自动按需导入 NaiveUI 组件，无需手动 `import`
- **API 自动导入**：使用 `unplugin-auto-import` 自动导入 Vue / Vue Router / Pinia 的常用 API
- **路由组件**：使用 `() => import()` 实现懒加载，按页面拆分 chunk
- **TypeScript**：全量类型覆盖，`vue-tsc` 构建前类型检查；别名 `@` → `src/`、`@vakao/shared` → `../shared/src/`
- **CSS**：UnoCSS 原子化类名 + NaiveUI 主题变量，不写独立样式文件
- **状态管理**：跨组件共享状态使用 Pinia（认证状态走 `stores/modules/auth`，文件列表状态走 `stores/modules/file-list`）
- **预览组件**：统一在 `file-list/components/` 目录，命名遵循 `*-file-preview.vue` 惯例，统一通过 `utils/preview-registry.ts` 分发
- **XSS 防护**：表格预览剥离 `<a>` 标签、Markdown 禁用 HTML 渲染、HTML 预览使用 `sandbox` iframe
