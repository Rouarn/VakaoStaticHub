import { defineConfig, presetAttributify, presetUno } from 'unocss';
import { colors, glassEffect } from './src/config/design-tokens';

/**
 * UnoCSS 配置（样式体系唯一配置点之一，与 config/naive-theme.ts 并列）
 *
 * - 暗色模式：class 策略（html.dark），与 NaiveUI darkTheme 由 app store 同步切换
 * - 颜色字面量全部来自 src/config/design-tokens.ts，组件内禁止散写 hex
 * - 玻璃拟态 / 文字色 / 阴影统一收敛为 shortcuts，组件只引用语义化类名
 */
export default defineConfig({
  presets: [presetUno({ dark: 'class' }), presetAttributify()],
  theme: {
    colors: {
      brand: colors.brand,
      surface: {
        DEFAULT: colors.bg.light,
        dark: colors.bg.dark,
      },
      glass: {
        DEFAULT: colors.glass.light,
        dark: colors.glass.dark,
        solid: colors.glass.darkSolid,
        border: colors.glass.borderLight,
        'border-dark': colors.glass.borderDark,
      },
      ink: {
        DEFAULT: colors.ink.primary,
        sub: colors.ink.secondary,
        dark: colors.ink.darkPrimary,
        'dark-sub': colors.ink.darkSecondary,
      },
    },
    boxShadow: {
      glass: `0 8px 32px ${colors.shadow.glassLight}`,
      'glass-dark': `0 8px 32px ${colors.shadow.glassDark}`,
      lift: `0 16px 40px ${colors.shadow.liftLight}`,
      'lift-dark': `0 16px 40px ${colors.shadow.liftDark}`,
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
  rules: [
    // 背景光晕层：径向渐变不便于类名表达，用 rule 从令牌常量生成，避免色值外泄
    [
      'aurora-light',
      {
        background: `radial-gradient(640px circle at 12% 8%, ${colors.halo.purpleLight}, transparent 70%), radial-gradient(520px circle at 88% 12%, ${colors.halo.pinkLight}, transparent 70%)`,
      },
    ],
    [
      'aurora-dark',
      {
        background: `radial-gradient(720px circle at 18% 8%, ${colors.halo.purpleDark}, transparent 70%), radial-gradient(620px circle at 82% 78%, ${colors.halo.tealDark}, transparent 70%)`,
      },
    ],
  ],
  shortcuts: {
    // —— 玻璃拟态 ——
    'glass-panel':
      'bg-glass dark:bg-glass-dark backdrop-blur-[20px] backdrop-saturate-150 border border-glass-border dark:border-glass-border-dark rounded-2xl shadow-glass dark:shadow-glass-dark',
    'glass-card':
      'glass-panel transition-all duration-300 hover:-translate-y-1 hover:shadow-lift dark:hover:shadow-lift-dark',
    'glass-chip':
      'bg-glass dark:bg-glass-dark border border-glass-border dark:border-glass-border-dark rounded-full backdrop-blur-[12px]',
    // —— 文字 ——
    'text-ink': 'text-ink dark:text-ink-dark',
    'text-ink-sub': 'text-ink-sub dark:text-ink-dark-sub',
    // —— 页面 ——
    'page-bg': 'bg-surface dark:bg-surface-dark',
    // —— 图标按钮（系统侧边栏） ——
    'rail-icon':
      'w-11 h-11 flex items-center justify-center rounded-xl text-ink-sub dark:text-ink-dark-sub transition-all duration-200 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-white/60 dark:hover:bg-white/8',
    'rail-icon-active':
      'text-brand-600 dark:text-brand-400 bg-white/80 dark:bg-white/10 shadow-glass',
  },
  preflights: [
    {
      getCSS: () => `
        html, body, #app { height: 100%; }
        body { overflow: hidden; }
        /* 深色下图片默认降透明度，hover 恢复（视觉规范） */
        html.dark img { opacity: 0.85; transition: opacity 0.25s ease; }
        html.dark img:hover { opacity: 1; }
        /* NaiveUI 组件级玻璃化：颜色由 naive-theme.ts 负责，这里只补模糊 */
        .n-card, .n-modal, .n-dialog, .n-popover, .n-dropdown-menu {
          backdrop-filter: ${glassEffect.backdropFilter};
        }
        /* 滚动条 */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${colors.ink.secondary}44; border-radius: 8px; }
        ::-webkit-scrollbar-thumb:hover { background: ${colors.ink.secondary}88; }
        ::-webkit-scrollbar-track { background: transparent; }
        /* 路由过渡 */
        .fade-slide-enter-active, .fade-slide-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
        .fade-slide-enter-from { opacity: 0; transform: translateY(10px); }
        .fade-slide-leave-to { opacity: 0; transform: translateY(-6px); }
      `,
    },
  ],
  safelist: ['animate-fade-up', 'animate-fade-in'],
});
