/**
 * 设计令牌（全局唯一颜色来源）
 *
 * 所有颜色字面量只允许出现在本文件；UnoCSS（uno.config.ts）与
 * NaiveUI 主题覆盖（config/naive-theme.ts）都从这里取值，
 * 组件内禁止散写 hex / rgba。
 */

/** 品牌主色阶（紫） */
export const brand = {
  50: '#f5f3ff',
  100: '#ede9fe',
  200: '#ddd6fe',
  300: '#c4b5fd',
  400: '#a78bfa',
  500: '#8b5cf6',
  600: '#7c3aed',
  700: '#6d28d9',
  800: '#5b21b6',
  900: '#4c1d95',
  950: '#2e1065',
} as const;

export const colors = {
  /** 页面底色 */
  bg: {
    light: '#eef2f6',
    dark: '#0b0f19',
  },
  /** 玻璃面板 */
  glass: {
    light: 'rgba(255,255,255,0.65)',
    dark: 'rgba(22,30,46,0.6)',
    /** 浅色模式下更实一级的浮层（Tooltip 等需要保证文字对比度的场景） */
    solidLight: 'rgba(255,255,255,0.96)',
    /** 深色模式下更实一级的浮层（弹窗/下拉） */
    darkSolid: 'rgba(26,35,54,0.92)',
    borderLight: 'rgba(255,255,255,0.9)',
    borderDark: 'rgba(255,255,255,0.06)',
  },
  /** 文字 */
  ink: {
    primary: '#212b3a',
    secondary: '#5b6b82',
    darkPrimary: '#e2e8f0',
    darkSecondary: '#8b9bb4',
  },
  /** 背景光晕 */
  halo: {
    purpleLight: 'rgba(167,139,250,0.32)',
    pinkLight: 'rgba(244,114,182,0.24)',
    purpleDark: 'rgba(124,58,237,0.16)',
    tealDark: 'rgba(45,212,191,0.10)',
  },
  /** 阴影 */
  shadow: {
    glassLight: 'rgba(31,38,135,0.08)',
    glassDark: 'rgba(0,0,0,0.35)',
    liftLight: 'rgba(31,38,135,0.14)',
    liftDark: 'rgba(0,0,0,0.5)',
  },
  brand,
} as const;

/** 玻璃拟态共享参数（backdrop-filter 唯一配置点） */
export const glassEffect = {
  backdropFilter: 'blur(20px) saturate(150%)',
  borderRadius: '16px',
} as const;
