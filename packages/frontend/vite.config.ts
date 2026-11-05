import { exec } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';
import Components from 'unplugin-vue-components/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    UnoCSS(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        'pinia',
        {
          'vue-router': ['RouterLink', 'RouterView'],
        },
      ],
      dts: 'src/typings/auto-imports.d.ts',
    }),
    Components({
      dts: 'src/typings/components.d.ts',
      types: [{ from: 'vue-router', names: ['RouterLink', 'RouterView'] }],
      resolvers: [NaiveUiResolver()],
    }),
    // 在 dev server 监听成功后，用 Chrome 打开（而非系统默认浏览器）
    {
      name: 'open-chrome-on-dev',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const addr = server.httpServer?.address();
          if (!addr || typeof addr === 'string') return;
          const host = addr.address === '0.0.0.0' ? 'localhost' : addr.address;
          //延迟2秒，确保服务器启动完成
          setTimeout(() => {
            exec(`open -a "Google Chrome" http://${host}:${addr.port}`);
          }, 2000);
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@vakao/shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // highlight.js 语言包只在懒加载的文本预览里出现，dev 首访才发现会触发
    // Vite 重新预构建（504 Outdated Optimize Dep）导致页面重载；
    // 提前声明让 dev 启动即完成预构建。生产构建不受影响。
    include: [
      'highlight.js/lib/core',
      'highlight.js/lib/languages/javascript',
      'highlight.js/lib/languages/typescript',
      'highlight.js/lib/languages/xml',
      'highlight.js/lib/languages/css',
      'highlight.js/lib/languages/json',
      'highlight.js/lib/languages/markdown',
      'highlight.js/lib/languages/bash',
      'highlight.js/lib/languages/yaml',
      'highlight.js/lib/languages/python',
      'highlight.js/lib/languages/sql',
      'highlight.js/lib/languages/java',
      'highlight.js/lib/languages/go',
      'highlight.js/lib/languages/ini',
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 9867,
    open: false, // 关闭内置打开行为，改用 listening 事件精确指定 Chrome
    proxy: {
      '/static': { target: 'http://localhost:9865', changeOrigin: true },
      // Swagger UI 页面(/docs)、其静态资源(/docs/*)与 OpenAPI JSON(/docs-json)
      // 不用 ^ 前缀的字符串键无法匹配 /docs-json，故使用正则
      '^/docs': { target: 'http://localhost:9865', changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        manualChunks(id) {
          // Vite/Rolldown/Vue 运行时助手必须固定到 runtime chunk。
          // 否则 Rolldown 会把 vite/preload-helper 合并进懒加载 chunk，
          // 导致入口 chunk 为了该助手静态依赖整个懒加载库，
          // index.html 首屏直接 modulepreload 它，造成白屏。
          if (
            id.includes('vite/preload-helper') ||
            id.includes('vite/modulepreload-polyfill') ||
            id.includes('plugin-vue:export-helper')
          ) {
            return 'rolldown-runtime';
          }
          if (id.includes('node_modules')) {
            // 仅对入口静态依赖的库做固定分包；按需加载的预览库
            // （video.js / pdfjs-dist / xlsx / docx-preview / highlight.js /
            // markdown-it 等，见 utils/preview-registry）绝不能 return 固定
            // chunk 名：Rolldown 会把 __vitePreload 助手合并进该命名 chunk，
            // 迫使入口静态依赖它们。不设 vendor 兜底同理——交给默认分包
            // 才能保持懒加载语义。
            if (id.includes('naive-ui')) {
              return 'naive-ui';
            }
            if (
              id.includes('vue') ||
              id.includes('vue-router') ||
              id.includes('pinia')
            ) {
              return 'vue-vendor';
            }
            if (id.includes('axios') || id.includes('dayjs')) {
              return 'utils-vendor';
            }
            if (id.includes('@iconify') || id.includes('@vicons')) {
              return 'icons-vendor';
            }
          }
        },
      },
      onwarn(warning, warn) {
        if (
          warning.code === 'INVALID_ANNOTATION' &&
          warning.message.includes('@vueuse/core')
        ) {
          return;
        }
        warn(warning);
      },
    },
    // pdfjs-dist 懒加载 chunk 约 1MB（仅打开 PDF 预览时按需加载），调高阈值避免误报
    chunkSizeWarningLimit: 1500,
  },
});
