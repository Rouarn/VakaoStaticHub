/**
 * video.js 懒加载器
 *
 * video.js v8 构建产物约 676KB（gzip ~180KB），只能在用户真正打开视频预览时
 * 通过动态 import 加载，避免拖入首屏 vendor chunk。
 * 加载结果会被缓存，重复调用只拉取一次；页面空闲时可调用 prefetchVideoPlayer 预热。
 */
type VideoJsModule = typeof import('video.js');
export type VideoJsStatic = VideoJsModule['default'];
export type VideoJsPlayer = ReturnType<VideoJsStatic>;

let loaderPromise: Promise<VideoJsStatic> | null = null;
let prefetchScheduled = false;

export function loadVideoPlayer(): Promise<VideoJsStatic> {
  if (!loaderPromise) {
    const promise = Promise.all([
      import('video.js'),
      import('video.js/dist/video-js.min.css'),
    ]).then(([mod]) => mod.default);
    // 加载失败（网络抖动/chunk 失效）时清空缓存，允许后续重试
    promise.catch(() => {
      loaderPromise = null;
    });
    loaderPromise = promise;
  }
  return loaderPromise;
}

/**
 * 浏览器空闲时预取 video.js，使首次打开视频预览时 chunk 大概率已在缓存中。
 * 不阻塞首屏渲染；开启省流模式（save-data）时跳过；预取失败允许后续重试。
 */
export function prefetchVideoPlayer(): void {
  if (loaderPromise || prefetchScheduled) return;

  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  if (conn?.saveData) return;

  prefetchScheduled = true;

  const schedule: (cb: () => void) => void =
    'requestIdleCallback' in window
      ? (cb) => window.requestIdleCallback(cb, { timeout: 3000 })
      : (cb) => window.setTimeout(cb, 1);

  schedule(() => {
    loadVideoPlayer().catch(() => {
      loaderPromise = null;
      prefetchScheduled = false;
    });
  });
}
