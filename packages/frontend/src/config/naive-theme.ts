import type { GlobalThemeOverrides } from 'naive-ui';
import { colors, glassEffect } from './design-tokens';

/**
 * NaiveUI 主题覆盖（组件级样式的唯一配置点，与 uno.config.ts 并列）
 *
 * - 色值全部来自 design-tokens.ts，禁止在这里新增字面量
 * - light/dark 两份 overrides，由 App.vue 按主题切换注入 NConfigProvider
 * - 面板类组件（Card/Dialog/Modal/Popover/Dropdown）底色给玻璃色，
 *   backdrop-filter 模糊由 uno.config.ts 的 preflight 统一附加
 */

const commonBase = {
  primaryColor: colors.brand[600],
  primaryColorHover: colors.brand[500],
  primaryColorPressed: colors.brand[700],
  primaryColorSuppl: colors.brand[500],
  borderRadius: '10px',
  borderRadiusSmall: '8px',
} as const;

export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    ...commonBase,
    textColorBase: colors.ink.primary,
    textColor1: colors.ink.primary,
    textColor2: colors.ink.secondary,
  },
  Card: {
    color: colors.glass.light,
    borderColor: colors.glass.borderLight,
    borderRadius: glassEffect.borderRadius,
  },
  Dialog: {
    color: colors.glass.light,
    borderRadius: glassEffect.borderRadius,
  },
  Modal: { borderRadius: glassEffect.borderRadius },
  Popover: { color: colors.glass.light, borderRadius: '12px' },
  Dropdown: { color: colors.glass.light, borderRadius: '12px' },
  Tooltip: { borderRadius: '8px' },
  Menu: { borderRadius: '12px' },
  DataTable: {
    thColor: 'transparent',
    tdColor: 'transparent',
    borderColor: colors.glass.borderLight,
  },
  Pagination: { itemBorderRadius: '8px' },
};

export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    ...commonBase,
    primaryColor: colors.brand[500],
    primaryColorHover: colors.brand[400],
    primaryColorPressed: colors.brand[600],
    primaryColorSuppl: colors.brand[400],
    textColorBase: colors.ink.darkPrimary,
    textColor1: colors.ink.darkPrimary,
    textColor2: colors.ink.darkSecondary,
  },
  Card: {
    color: colors.glass.dark,
    borderColor: colors.glass.borderDark,
    borderRadius: glassEffect.borderRadius,
    textColor: colors.ink.darkPrimary,
  },
  Dialog: {
    color: colors.glass.darkSolid,
    borderRadius: glassEffect.borderRadius,
    textColor: colors.ink.darkPrimary,
  },
  Modal: { borderRadius: glassEffect.borderRadius },
  Popover: {
    color: colors.glass.darkSolid,
    borderRadius: '12px',
    textColor: colors.ink.darkPrimary,
  },
  Dropdown: {
    color: colors.glass.darkSolid,
    borderRadius: '12px',
    textColor: colors.ink.darkPrimary,
  },
  Tooltip: { borderRadius: '8px' },
  Menu: { borderRadius: '12px' },
  DataTable: {
    thColor: 'transparent',
    tdColor: 'transparent',
    borderColor: colors.glass.borderDark,
  },
  Pagination: { itemBorderRadius: '8px' },
};
