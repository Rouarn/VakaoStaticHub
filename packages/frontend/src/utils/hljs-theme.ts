/**
 * highlight.js 代码配色：github 明/暗双主题，随系统主题切换。
 * CSS 以 ?inline 字符串注入单个 <style> 标签，text / markdown 预览共用。
 */
import { watch } from 'vue';
import { useDark } from '@vueuse/core';
import lightCss from 'highlight.js/styles/github.css?inline';
import darkCss from 'highlight.js/styles/github-dark.css?inline';

const STYLE_ID = 'hljs-theme-style';

export const useHljsTheme = (): void => {
  const isDark = useDark();

  watch(
    isDark,
    (dark) => {
      let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
      }
      el.textContent = dark ? darkCss : lightCss;
    },
    { immediate: true },
  );
};
