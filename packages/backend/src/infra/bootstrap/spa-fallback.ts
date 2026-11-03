import { Logger, type INestApplication } from '@nestjs/common';
import * as express from 'express';
import { access } from 'node:fs/promises';
import { join, sep } from 'node:path';

const logger = new Logger('SpaFallback');

/**
 * 托管前端构建产物并为前端路由提供 SPA fallback。
 *
 * 中间件在 `listen()` 之前注册，先于 Nest 路由生效：
 * - 已存在的静态文件（/assets/**、favicon.ico 等）直接命中，不进入 API 路由；
 * - 无扩展名、非 /static /docs 且 Accept 含 text/html 的 GET/HEAD → index.html；
 * - 其余请求继续交给 Nest（未知 /static 路径仍由全局过滤器返回 JSON 404）。
 */
export async function setupSpaFallback(
  app: INestApplication,
  staticPrefix: string,
  webDir?: string,
): Promise<void> {
  if (!webDir) {
    logger.warn('未配置前端产物目录（server.webDir），仅提供 API');
    return;
  }
  const indexHtmlPath = join(webDir, 'index.html');

  try {
    await access(indexHtmlPath);
  } catch {
    logger.warn(
      `未找到前端构建产物：${indexHtmlPath}；仅提供 API。请先执行 pnpm build，或用 WEB_DIR 指定产物目录`,
    );
    return;
  }

  const assetsDir = join(webDir, 'assets') + sep;

  // 缓存策略：带哈希的 /assets/** 长缓存，index.html 禁止缓存
  app.use(
    express.static(webDir, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        if (filePath === indexHtmlPath) {
          res.setHeader('Cache-Control', 'no-store, must-revalidate');
        } else if (filePath.startsWith(assetsDir)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance() as express.Application;

  const hasExtension = (path: string) =>
    /\.[a-zA-Z0-9]+$/.test(path.split('?')[0]);
  const isApiPath = (path: string) =>
    path.startsWith(`/${staticPrefix}`) || path.startsWith('/docs');

  instance.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        !hasExtension(req.path) &&
        !isApiPath(req.path) &&
        (req.headers.accept || '').includes('text/html')
      ) {
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        return res.sendFile(indexHtmlPath);
      }
      return next();
    },
  );
}
