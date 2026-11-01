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
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@vakao/shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 9867,
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
        chunkFileNames(chunkInfo) {
          // jit-viewer 走默认分包（保持其内部 CAD/3D 等二级懒加载 chunk），
          // 这里仅统一加 jit- 前缀，便于在 Network 面板识别
          if (
            (chunkInfo.moduleIds ?? []).some((id) =>
              id.includes('node_modules/jit-viewer'),
            )
          ) {
            return 'assets/js/jit-[name]-[hash].js';
          }
          return 'assets/js/[name]-[hash].js';
        },
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        manualChunks(id) {
          // Vite/Rolldown/Vue 运行时助手必须固定到 runtime chunk。
          // 否则 Rolldown 会把 vite/preload-helper 合并进 jit-viewer chunk，
          // 导致入口 chunk 为了该助手静态依赖 8MB 的预览 SDK，
          // index.html 首屏直接 modulepreload 它，造成白屏。
          if (
            id.includes('vite/preload-helper') ||
            id.includes('vite/modulepreload-polyfill') ||
            id.includes('plugin-vue:export-helper')
          ) {
            return 'rolldown-runtime';
          }
          if (id.includes('node_modules')) {
            // jit-viewer / video.js 仅被动态 import（见 utils/jit-viewer-loader、
            // utils/video-player-loader），必须交给默认分包，切勿 return 固定
            // chunk 名：Rolldown 会把 __vitePreload 助手合并进该命名 chunk，
            // 迫使入口静态依赖整个预览 SDK / 播放器。
            if (id.includes('jit-viewer') || id.includes('video.js')) {
              return;
            }
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
            return 'vendor';
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
        if (warning.code === 'EVAL' && warning.message.includes('jit-viewer')) {
          return;
        }
        if (warning.message?.includes('jit-viewer')) {
          return;
        }
        warn(warning);
      },
    },
    // jit-viewer 核心 chunk 约 8MB（仅点击预览时按需加载），调高阈值避免误报
    chunkSizeWarningLimit: 12000,
  },
});
