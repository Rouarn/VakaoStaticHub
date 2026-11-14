/**
 * 识别媒体被 CSP 拦截
 *
 * <video>/<audio> 被 CSP 拦截时只会触发普通 error 事件（error.code 常见为 4），
 * 与「编码不支持」在事件层面无法区分；securitypolicyviolation 才是准确信号。
 * 两个预览组件共用这一份判定，避免各自写一遍 URL 比对。
 */
export function watchMediaCsp(
  src: () => string,
  onBlocked: () => void,
): () => void {
  function sameResource(blocked: string): boolean {
    if (!blocked) return false;
    try {
      const blockedUrl = new URL(blocked, window.location.href);
      const srcUrl = new URL(src(), window.location.href);
      return (
        blockedUrl.origin === srcUrl.origin &&
        blockedUrl.pathname === srcUrl.pathname
      );
    } catch {
      return false;
    }
  }

  function handler(e: SecurityPolicyViolationEvent) {
    const directive = e.violatedDirective || '';
    if (
      !directive.startsWith('media-src') &&
      !directive.startsWith('default-src')
    ) {
      return;
    }
    if (sameResource(e.blockedURI)) onBlocked();
  }

  document.addEventListener('securitypolicyviolation', handler);
  return () => document.removeEventListener('securitypolicyviolation', handler);
}
