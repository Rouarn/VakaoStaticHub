/**
 * 设计令牌（全局唯一颜色来源）
 *
 * 两层结构：
 * 1) 基础色板：品牌色阶、文字、语义色 —— 供 NaiveUI 主题与 Uno 颜色使用
 * 2) 材质令牌（material）：管理端 "cool"（冷灰玻璃）与对外页 "fluid"（彩色流体），
 *    各含 light / dark 两份；由 uno.config.ts 生成为 CSS 变量，
 *    组件只引用 glass-panel / glass-card / glass-chip 等语义类名。
 *
 * 约定：组件与页面内禁止散写 hex / rgba；新增颜色一律加在这里。
 */

/** 品牌主色阶（低饱和靛紫，冷灰管理端下的动作色） */
export const brand = {
  50: '#f5f5fb',
  100: '#ecebf8',
  200: '#d9d7f0',
  300: '#bbb7e4',
  400: '#9a93d5',
  500: '#7b72c6',
  600: '#5f55b8',
  700: '#4d45a0',
  800: '#403a86',
  900: '#37326e',
  950: '#221f48',
} as const;

export const colors = {
  /** 页面底色（壁纸缺省 / 回退） */
  bg: {
    light: '#dfe5ee',
    dark: '#0d1014',
  },
  /** 面板与浮层（NaiveUI 侧取这里的值） */
  glass: {
    light: 'rgba(255,255,255,0.66)',
    dark: 'rgba(30,33,40,0.64)',
    /** 浅色模式下更实一级的浮层（Tooltip / 下拉需要保证文字对比度） */
    solidLight: 'rgba(255,255,255,0.94)',
    /** 深色模式下更实一级的浮层（弹窗/下拉） */
    darkSolid: 'rgba(36,39,47,0.90)',
    borderLight: 'rgba(255,255,255,0.72)',
    /** 深色面板边界：过低的白色透明度在深色底上会“糊”成一片 */
    borderDark: 'rgba(255,255,255,0.12)',
    /** 表单控件底（比面板再实一级，避免深色下输入框与面板同色） */
    inputLight: 'rgba(255,255,255,0.62)',
    inputDark: 'rgba(255,255,255,0.07)',
  },
  /** 文字 */
  ink: {
    primary: '#15181d',
    secondary: '#4b5563',
    darkPrimary: '#e9ebef',
    darkSecondary: '#a3adbb',
    /** 占位符：只求可读（≥3:1），不抢正文 */
    placeholderLight: '#667085',
    placeholderDark: '#8b93a1',
    /** 品牌填充底上的文字 */
    onBrand: '#ffffff',
    onBrandMuted: 'rgba(255,255,255,0.55)',
  },
  /** 语义色 */
  state: {
    okLight: '#2f7f6a',
    okDark: '#7fd6b4',
    warnLight: '#96631f',
    warnDark: '#e0b362',
    dangerLight: '#a14a3d',
    dangerDark: '#e79a8f',
    infoLight: '#3a5bbf',
    infoDark: '#9db4f0',
  },
  /**
   * 遮罩层（全站加载遮罩唯一来源）
   *
   * rgba 的 alpha 即遮罩不透明度：数值越小越透明、越能看见背后的页面；
   * 深浅色各一份，保证遮罩上的文字与转圈在两种主题下都清晰可读。
   */
  overlay: {
    loadingLight: 'rgba(255,255,255,0.42)',
    loadingDark: 'rgba(12,15,20,0.34)',
  },
  /** 焦点环 */
  focus: {
    ringLight: 'rgba(95,85,184,0.18)',
    ringDark: 'rgba(154,147,213,0.24)',
  },
  /** 阴影 */
  shadow: {
    glassLight: 'rgba(23,31,50,0.18)',
    glassDark: 'rgba(0,0,0,0.45)',
    liftLight: 'rgba(23,31,50,0.26)',
    liftDark: 'rgba(0,0,0,0.6)',
  },
  brand,
} as const;

/** 玻璃材质共享参数（backdrop-filter 唯一配置点） */
export const glassEffect = {
  backdropFilter: 'blur(24px) saturate(118%)',
  borderRadius: '16px',
} as const;

/** 一套材质在某个主题下的完整描述 */
export interface MaterialPalette {
  /** 壁纸：多层渐变叠加（直接作为 background 值） */
  wall: string;
  /** 四个漂移光斑的颜色 */
  blobs: [string, string, string, string];
  /** 光斑整体不透明度 */
  blobOpacity: number;
  /** 光斑漂移周期 */
  drift: string;
  /** 面板（承载内容、需要模糊） */
  panel: string;
  /** 卡片（比面板更实一级，不做 backdrop-filter） */
  panelStrong: string;
  /** 胶囊 / 芯片底色 */
  chip: string;
  /** 面板描边（玻璃棱线） */
  line: string;
  /** 发丝分隔线 */
  lineSoft: string;
  /** hover 底色 */
  hover: string;
  /** 面板投影 */
  shadow: string;
  /** 模糊半径与饱和度 */
  blur: string;
  sat: string;
  /** 四周压暗，让窗口浮起来 */
  vignette: string;
  /** 颗粒噪点强度 */
  grain: number;
  /** 旋转极光（仅对外页使用；管理端为 none） */
  aurora: string;
}

/**
 * 材质定义
 *
 * - cool：管理端。冷灰蓝壁纸 + 低饱和玻璃，久看不累
 * - fluid：对外页（登录 / 分享访问 / 文件预览）。高饱和光斑 + 旋转极光
 */
export const materials: Record<
  'cool' | 'fluid',
  Record<'light' | 'dark', MaterialPalette>
> = {
  cool: {
    light: {
      wall: `radial-gradient(120% 90% at 8% 0%, #a6b9d3 0%, transparent 58%),
        radial-gradient(100% 80% at 96% 8%, #d8dfe9 0%, transparent 52%),
        radial-gradient(100% 90% at 72% 100%, #b0c2d8 0%, transparent 58%),
        linear-gradient(160deg, #d5dfeb 0%, #e9eef5 45%, #d3dfee 100%)`,
      blobs: ['#b7c4d8', '#cfd7e4', '#b2c0d6', '#c6d1e2'],
      blobOpacity: 0.5,
      drift: '100s',
      panel: 'rgba(255,255,255,0.5)',
      panelStrong: 'rgba(255,255,255,0.7)',
      chip: 'rgba(255,255,255,0.45)',
      line: 'rgba(255,255,255,0.7)',
      lineSoft: 'rgba(15,23,42,0.075)',
      hover: 'rgba(255,255,255,0.86)',
      shadow: '0 8px 24px -16px rgba(23,31,50,0.35)',
      blur: '24px',
      sat: '118%',
      vignette:
        'radial-gradient(120% 90% at 50% 40%, transparent 45%, rgba(30,41,59,0.14) 100%)',
      grain: 0.07,
      aurora: 'none',
    },
    dark: {
      wall: `radial-gradient(110% 85% at 10% 4%, #1d2532 0%, transparent 55%),
        radial-gradient(100% 80% at 94% 8%, #16202c 0%, transparent 50%),
        radial-gradient(90% 85% at 82% 96%, #131c27 0%, transparent 55%),
        linear-gradient(150deg, #0a0d11 0%, #101419 50%, #090c10 100%)`,
      blobs: ['#232b38', '#1b2432', '#1a222d', '#202834'],
      blobOpacity: 0.42,
      drift: '110s',
      panel: 'rgba(30,33,40,0.55)',
      panelStrong: 'rgba(38,42,50,0.66)',
      chip: 'rgba(255,255,255,0.055)',
      line: 'rgba(255,255,255,0.12)',
      lineSoft: 'rgba(255,255,255,0.075)',
      hover: 'rgba(255,255,255,0.08)',
      shadow: '0 12px 30px -18px rgba(0,0,0,0.6)',
      blur: '26px',
      sat: '115%',
      vignette:
        'radial-gradient(120% 90% at 50% 40%, transparent 42%, rgba(0,0,0,0.42) 100%)',
      grain: 0.05,
      aurora: 'none',
    },
  },
  fluid: {
    light: {
      wall: `radial-gradient(90% 75% at 6% -4%, #ff2d8a 0%, transparent 55%),
        radial-gradient(85% 70% at 98% 2%, #00c2ff 0%, transparent 52%),
        radial-gradient(85% 70% at 92% 100%, #ff7a59 0%, transparent 52%),
        radial-gradient(95% 80% at -6% 98%, #7b2ff7 0%, transparent 55%),
        linear-gradient(150deg, #fff0f7 0%, #f0f0ff 45%, #eafaff 100%)`,
      blobs: ['#7b2ff7', '#00c2ff', '#ff2d8a', '#ff7a59'],
      blobOpacity: 0.9,
      drift: '26s',
      panel: 'rgba(255,255,255,0.58)',
      panelStrong: 'rgba(255,255,255,0.8)',
      chip: 'rgba(255,255,255,0.42)',
      line: 'rgba(255,255,255,0.6)',
      lineSoft: 'rgba(34,16,48,0.09)',
      hover: 'rgba(255,255,255,0.9)',
      shadow: '0 24px 60px -30px rgba(74,12,86,0.45)',
      blur: '34px',
      sat: '210%',
      vignette:
        'radial-gradient(120% 90% at 50% 40%, transparent 42%, rgba(60,8,74,0.18) 100%)',
      grain: 0.1,
      aurora:
        'conic-gradient(from 0deg, #ff2d8a, #7b2ff7, #00c2ff, #7b2ff7, #ff2d8a)',
    },
    dark: {
      wall: `radial-gradient(85% 70% at 6% -4%, #7b2ff7 0%, transparent 55%),
        radial-gradient(80% 65% at 98% 2%, #0a6cff 0%, transparent 52%),
        radial-gradient(85% 70% at 92% 100%, #ff2d8a 0%, transparent 50%),
        radial-gradient(90% 80% at -6% 98%, #00c2ff 0%, transparent 55%),
        linear-gradient(150deg, #180a2e 0%, #2a0b3d 45%, #061026 100%)`,
      blobs: ['#7b2ff7', '#0a6cff', '#ff2d8a', '#00c2ff'],
      blobOpacity: 0.55,
      drift: '30s',
      panel: 'rgba(40,26,66,0.5)',
      panelStrong: 'rgba(52,36,80,0.66)',
      chip: 'rgba(255,255,255,0.08)',
      line: 'rgba(255,255,255,0.18)',
      lineSoft: 'rgba(255,255,255,0.1)',
      hover: 'rgba(255,255,255,0.1)',
      shadow: '0 28px 60px -30px rgba(0,0,0,0.7)',
      blur: '34px',
      sat: '200%',
      vignette:
        'radial-gradient(120% 90% at 50% 40%, transparent 38%, rgba(0,0,0,0.5) 100%)',
      grain: 0.08,
      aurora:
        'conic-gradient(from 0deg, #ff2d8a, #7b2ff7, #00c2ff, #7b2ff7, #ff2d8a)',
    },
  },
} as const;
