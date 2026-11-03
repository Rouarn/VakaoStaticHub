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

/** 表单控件（浅色）：占位符默认 #c2c2c2 在玻璃底上低于 3:1，统一抬到令牌值 */
const lightInput = {
  color: colors.glass.inputLight,
  colorFocus: colors.glass.solidLight,
  textColor: colors.ink.primary,
  placeholderColor: colors.ink.placeholderLight,
  border: `1px solid ${colors.glass.borderLight}`,
  borderHover: `1px solid ${colors.brand[300]}`,
  borderFocus: `1px solid ${colors.brand[500]}`,
  boxShadowFocus: `0 0 0 2px ${colors.brand[200]}`,
  caretColor: colors.brand[600],
  arrowColor: colors.ink.secondary,
} as const;

/** 表单控件（深色）：默认深色输入框与面板同色，靠边界区分 */
const darkInput = {
  color: colors.glass.inputDark,
  colorFocus: colors.glass.darkSolid,
  textColor: colors.ink.darkPrimary,
  placeholderColor: colors.ink.placeholderDark,
  border: `1px solid ${colors.glass.borderDark}`,
  borderHover: `1px solid ${colors.brand[400]}`,
  borderFocus: `1px solid ${colors.brand[500]}`,
  boxShadowFocus: `0 0 0 2px ${colors.halo.purpleDark}`,
  caretColor: colors.brand[400],
  arrowColor: colors.ink.darkSecondary,
} as const;

export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    ...commonBase,
    textColorBase: colors.ink.primary,
    textColor1: colors.ink.primary,
    textColor2: colors.ink.secondary,
  },
  Input: lightInput,
  InternalSelection: {
    ...lightInput,
    borderActive: `1px solid ${colors.brand[500]}`,
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
  Popover: {
    color: colors.glass.light,
    borderRadius: '12px',
    textColor: colors.ink.primary,
  },
  Dropdown: {
    color: colors.glass.light,
    borderRadius: '12px',
    optionTextColor: colors.ink.primary,
    optionTextColorHover: colors.ink.primary,
    optionTextColorActive: colors.ink.primary,
    optionTextColorChildActive: colors.ink.primary,
  },
  // Tooltip 必须给不透明底色 + 深色文字：
  // 默认是浅色文字叠在玻璃半透明底上，实测对比度只有 1:1。
  // Popover 的全局覆盖在 Naive 合并顺序里会盖掉 Tooltip 自带的 color，
  // 所以必须通过 peers.Popover（最高优先级）注入。
  Tooltip: {
    borderRadius: '8px',
    peers: {
      Popover: {
        color: colors.glass.solidLight,
        textColor: colors.ink.primary,
      },
    },
  },
  Select: {
    peers: {
      InternalSelectMenu: {
        color: colors.glass.solidLight,
        optionTextColor: colors.ink.primary,
        optionTextColorActive: colors.ink.primary,
      },
    },
  },
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
    // 500 号紫上的白字只有 4.2:1，深色下用 600 号保证主按钮文字 ≥4.5:1
    primaryColor: colors.brand[600],
    primaryColorHover: colors.brand[500],
    primaryColorPressed: colors.brand[700],
    primaryColorSuppl: colors.brand[500],
    textColorBase: colors.ink.darkPrimary,
    textColor1: colors.ink.darkPrimary,
    textColor2: colors.ink.darkSecondary,
  },
  Input: darkInput,
  InternalSelection: {
    ...darkInput,
    borderActive: `1px solid ${colors.brand[500]}`,
  },
  // 深色主题默认给主按钮黑字（--n-text-color: #000），紫底黑字发脏且与浅色主题不一致
  Button: {
    textColorPrimary: colors.ink.onBrand,
    textColorHoverPrimary: colors.ink.onBrand,
    textColorPressedPrimary: colors.ink.onBrand,
    textColorFocusPrimary: colors.ink.onBrand,
    textColorDisabledPrimary: colors.ink.onBrandMuted,
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
    optionTextColor: colors.ink.darkPrimary,
    optionTextColorHover: colors.ink.darkPrimary,
    optionTextColorActive: colors.ink.darkPrimary,
    optionTextColorChildActive: colors.ink.darkPrimary,
  },
  Tooltip: {
    borderRadius: '8px',
    peers: {
      Popover: {
        color: colors.glass.darkSolid,
        textColor: colors.ink.darkPrimary,
      },
    },
  },
  Select: {
    peers: {
      InternalSelectMenu: {
        color: colors.glass.darkSolid,
        optionTextColor: colors.ink.darkPrimary,
        optionTextColorActive: colors.ink.darkPrimary,
      },
    },
  },
  Menu: { borderRadius: '12px' },
  DataTable: {
    thColor: 'transparent',
    tdColor: 'transparent',
    borderColor: colors.glass.borderDark,
  },
  Pagination: { itemBorderRadius: '8px' },
};
