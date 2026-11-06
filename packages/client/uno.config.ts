import { defineConfig, presetAttributify, presetUno } from 'unocss';
import {
  colors,
  glassEffect,
  materials,
  type MaterialPalette,
} from './src/config/design-tokens';

/**
 * UnoCSS 配置（样式体系唯一配置点之一，与 config/naive-theme.ts 并列）
 *
 * - 暗色模式：class 策略（html.dark），与 NaiveUI darkTheme 由 app store 同步切换
 * - 材质：html[data-material="cool"|"fluid"] 两套 CSS 变量，由 App.vue 按路由切换。
 *   cool = 管理端冷灰玻璃；fluid = 对外页（登录/分享访问/预览）彩色流体。
 * - 组件只引用 glass-panel / glass-card / glass-chip / rail-icon 等语义类名；
 *   颜色字面量全部来自 src/config/design-tokens.ts。
 */

/** 把一套材质展开为 CSS 变量 */
function materialVars(p: MaterialPalette): string {
  return [
    `--mat-panel: ${p.panel};`,
    `--mat-panel-strong: ${p.panelStrong};`,
    `--mat-chip: ${p.chip};`,
    `--mat-line: ${p.line};`,
    `--mat-line-soft: ${p.lineSoft};`,
    `--mat-hover: ${p.hover};`,
    `--mat-shadow: ${p.shadow};`,
    `--mat-blur: ${p.blur};`,
    `--mat-sat: ${p.sat};`,
    `--mat-wall: ${p.wall};`,
    `--mat-blob-1: ${p.blobs[0]};`,
    `--mat-blob-2: ${p.blobs[1]};`,
    `--mat-blob-3: ${p.blobs[2]};`,
    `--mat-blob-4: ${p.blobs[3]};`,
    `--mat-blob-opacity: ${p.blobOpacity};`,
    `--mat-drift: ${p.drift};`,
    `--mat-vignette: ${p.vignette};`,
    `--mat-grain: ${p.grain};`,
    `--mat-aurora: ${p.aurora};`,
  ].join('\n        ');
}

export default defineConfig({
  presets: [presetUno({ dark: 'class' }), presetAttributify()],
  theme: {
    colors: {
      brand: colors.brand,
      surface: {
        DEFAULT: colors.bg.light,
        dark: colors.bg.dark,
      },
      // 面板色统一走材质变量：同一套类名在 cool / fluid 下取到不同值
      glass: {
        DEFAULT: 'var(--mat-panel)',
        dark: 'var(--mat-panel)',
        solid: 'var(--mat-panel-strong)',
        border: 'var(--mat-line)',
        'border-dark': 'var(--mat-line)',
      },
      ink: {
        DEFAULT: colors.ink.primary,
        sub: colors.ink.secondary,
        dark: colors.ink.darkPrimary,
        'dark-sub': colors.ink.darkSecondary,
      },
    },
    boxShadow: {
      glass: `0 8px 24px -16px ${colors.shadow.glassLight}`,
      'glass-dark': `0 12px 30px -18px ${colors.shadow.glassDark}`,
      lift: `0 16px 40px -20px ${colors.shadow.liftLight}`,
      'lift-dark': `0 20px 46px -22px ${colors.shadow.liftDark}`,
    },
    animation: {
      keyframes: {
        'fade-up':
          '{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
        'fade-in': '{from{opacity:0}to{opacity:1}}',
      },
      durations: { 'fade-up': '0.35s', 'fade-in': '0.25s' },
      timingFns: { 'fade-up': 'ease-out', 'fade-in': 'ease-out' },
      counts: { 'fade-up': '1', 'fade-in': '1' },
    },
  },
  shortcuts: {
    // —— 材质层 ——
    // 面板：承载内容，带模糊（每个页面同时可见的面板数量有限）
    'glass-panel':
      'bg-[var(--mat-panel)] border border-solid border-[var(--mat-line)] rounded-2xl shadow-[var(--mat-shadow)] [backdrop-filter:blur(var(--mat-blur))_saturate(var(--mat-sat))] [-webkit-backdrop-filter:blur(var(--mat-blur))_saturate(var(--mat-sat))]',
    // 卡片：比面板再实一级，不做 backdrop-filter（列表里可能有几十张）
    'glass-card':
      'bg-[var(--mat-panel-strong)] border border-solid border-[var(--mat-line)] rounded-[18px] shadow-[var(--mat-shadow)] transition-colors duration-200 hover:bg-[var(--mat-hover)]',
    'glass-chip':
      'bg-[var(--mat-chip)] border border-solid border-[var(--mat-line)] rounded-full',
    // —— 文字 ——
    'text-ink': 'text-ink dark:text-ink-dark',
    'text-ink-sub': 'text-ink-sub dark:text-ink-dark-sub',
    // —— 页面 ——
    // 壁纸由 AppBackdrop 固定层绘制，页面本身透明
    'page-bg': 'bg-transparent',
    // —— 内容网格 ——
    'content-grid': 'grid gap-4',
    // —— 媒体卡片 ——
    'media-image':
      'w-full h-full object-cover transition-opacity duration-300 dark:opacity-85 hover:opacity-100 dark:hover:opacity-100',
    'media-frame':
      'relative overflow-hidden bg-gradient-to-br from-brand-100 to-brand-200/50 dark:from-brand-900/40 dark:to-brand-800/25',
    // —— 图标按钮（系统侧边栏） ——
    'rail-icon':
      'w-11 h-11 flex items-center justify-center rounded-xl text-ink-sub dark:text-ink-dark-sub transition-colors duration-200 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-[var(--mat-hover)]',
    'rail-icon-active':
      'text-brand-600 dark:text-brand-400 bg-[var(--mat-panel-strong)] shadow-[var(--mat-shadow)]',
  },
  preflights: [
    {
      getCSS: () => `
        /* ===== 材质变量（cool=管理端 / fluid=对外页） ===== */
        :root {
        ${materialVars(materials.cool.light)}
        }
        html[data-material="cool"] {
        ${materialVars(materials.cool.light)}
        }
        html.dark[data-material="cool"] {
        ${materialVars(materials.cool.dark)}
        }
        html[data-material="fluid"] {
        ${materialVars(materials.fluid.light)}
        }
        html.dark[data-material="fluid"] {
        ${materialVars(materials.fluid.dark)}
        }

        /* ===== 文本色与分隔线（全局组件样式用，非材质相关） ===== */
        :root {
          --ink-1: ${colors.ink.primary};
          --ink-2: ${colors.ink.secondary};
          --ink-3: ${colors.ink.placeholderLight};
          --line-soft: rgba(15, 23, 42, 0.075);
        }
        html.dark {
          --ink-1: ${colors.ink.darkPrimary};
          --ink-2: ${colors.ink.darkSecondary};
          --ink-3: ${colors.ink.placeholderDark};
          --line-soft: rgba(255, 255, 255, 0.075);
        }

        /* ===== 基础 ===== */
        html, body, #app { height: 100%; }
        html { background: ${colors.bg.light}; }
        html.dark { background: ${colors.bg.dark}; }
        body { overflow: hidden; background: transparent; }
        #app { position: relative; }

        /* ===== 壁纸层（AppBackdrop） ===== */
        .app-backdrop {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
        }
        .app-backdrop__wall {
          position: absolute;
          inset: -8%;
          background: var(--mat-wall);
        }
        .app-backdrop__aurora {
          display: none;
          position: absolute;
          inset: -25%;
          background: var(--mat-aurora);
          filter: blur(90px);
          opacity: 0.4;
          animation: mat-spin 34s linear infinite;
        }
        html[data-material="fluid"] .app-backdrop__aurora { display: block; }
        .app-backdrop__blob {
          position: absolute;
          border-radius: 50%;
          opacity: var(--mat-blob-opacity);
          animation: mat-drift var(--mat-drift) ease-in-out infinite alternate;
        }
        html[data-material="cool"] .app-backdrop__blob { filter: blur(100px); }
        html[data-material="fluid"] .app-backdrop__blob { filter: blur(46px); }
        .app-backdrop__blob.b1 { width: 620px; height: 620px; left: -8%; top: -14%; background: var(--mat-blob-1); }
        .app-backdrop__blob.b2 { width: 760px; height: 760px; right: -12%; top: -18%; background: var(--mat-blob-2); animation-delay: -8s; }
        .app-backdrop__blob.b3 { width: 560px; height: 560px; left: 18%; bottom: -22%; background: var(--mat-blob-3); animation-delay: -14s; }
        .app-backdrop__blob.b4 { width: 460px; height: 460px; right: 6%; bottom: -16%; background: var(--mat-blob-4); animation-delay: -22s; }
        .app-backdrop__vignette { position: absolute; inset: 0; background: var(--mat-vignette); }
        .app-backdrop__grain {
          position: absolute; inset: 0;
          opacity: var(--mat-grain);
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>");
        }
        @keyframes mat-drift {
          0%   { transform: translate3d(0, 0, 0) scale(1); }
          50%  { transform: translate3d(4%, 3%, 0) scale(1.08); }
          100% { transform: translate3d(-3%, 5%, 0) scale(0.96); }
        }
        @keyframes mat-spin { to { transform: rotate(360deg); } }

        /* 侧栏导航底部渐隐：隐藏滚动条后仍能暗示还有内容 */
        .nav-fade {
          mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
          -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
        }

        /* 登录按钮禁用态：保持"按钮"外观，而不是变成一行文字 */
        button.login-submit:disabled {
          background: var(--mat-chip) !important;
          border: 1px solid var(--mat-line) !important;
          color: var(--ink-3) !important;
          opacity: 1 !important;
          box-shadow: none !important;
        }

        /* ===== 指标条（原型：共享边框的 4 列指标，而不是 4 张浮卡） ===== */
        .metrics-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          background: var(--line-soft);
          border: 1px solid var(--mat-line);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: var(--mat-shadow);
        }
        .metrics-strip > .glass-card {
          border: 0;
          border-radius: 0;
          box-shadow: none;
          background: var(--mat-panel);
          min-width: 0;
        }
        @media (max-width: 1180px) {
          .metrics-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .metrics-strip { grid-template-columns: 1fr; }
        }

        /* ===== 数据表（原型规范：表头 34 / 行 44 / 发丝分隔 / 数字右对齐） ===== */
        .app-table { width: 100%; border-collapse: collapse; }
        .app-table thead th {
          height: 34px;
          padding: 0 14px;
          text-align: left;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          color: var(--ink-3);
          background: transparent;
          border-bottom: 1px solid var(--line-soft);
          white-space: nowrap;
        }
        .app-table tbody td {
          height: 44px;
          padding: 0 14px;
          font-size: 12.5px;
          color: var(--ink-2);
          border-bottom: 1px solid var(--line-soft);
          white-space: nowrap;
        }
        .app-table tbody tr:last-child td { border-bottom: 0; }
        .app-table tbody tr { transition: background 0.16s ease; }
        .app-table tbody tr:hover td { background: var(--mat-hover); }
        .app-table th.num,
        .app-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .app-table td.strong { color: var(--ink-1); font-weight: 550; }

        /* ===== 图片在深色下默认降透明度，hover 恢复 ===== */
        html.dark img { opacity: 0.85; transition: opacity 0.25s ease; }
        html.dark img:hover { opacity: 1; }

        /* ===== NaiveUI 浮层玻璃化：颜色由 naive-theme.ts 负责，这里只补模糊 ===== */
        .n-card, .n-modal, .n-dialog, .n-popover, .n-dropdown-menu {
          backdrop-filter: ${glassEffect.backdropFilter};
          -webkit-backdrop-filter: ${glassEffect.backdropFilter};
        }

        /* ===== 滚动条 ===== */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${colors.ink.secondary}44; border-radius: 8px; }
        ::-webkit-scrollbar-thumb:hover { background: ${colors.ink.secondary}88; }
        ::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-hidden { scrollbar-width: none; -ms-overflow-style: none; }
        .scrollbar-hidden::-webkit-scrollbar { display: none; width: 0; height: 0; }

        /* ===== 路由过渡 ===== */
        .fade-slide-enter-active, .fade-slide-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
        .fade-slide-enter-from { opacity: 0; transform: translateY(10px); }
        .fade-slide-leave-to { opacity: 0; transform: translateY(-6px); }

        /* 不支持 backdrop-filter 时退回高不透明材质，保证可读性 */
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .glass-panel { background: var(--mat-panel-strong); }
        }

        @media (prefers-reduced-motion: reduce) {
          .app-backdrop__blob, .app-backdrop__aurora { animation: none; }
        }
      `,
    },
  ],
  safelist: ['animate-fade-up', 'animate-fade-in'],
});
