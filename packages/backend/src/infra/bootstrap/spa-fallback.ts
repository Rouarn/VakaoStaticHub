import type { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 托管 cwd/web 构建产物，并为前端路由提供 SPA fallback。
 * 仅处理 GET、无扩展名、非 API 路径且 Accept 含 text/html 的请求。
 */
export async function setupSpaFallback(
  app: INestApplication,
  staticPrefix: string,
): Promise<void> {
  const webDir = join(process.cwd(), 'web');

  try {
    await access(webDir);
    app.use(express.static(webDir));
    const indexHtmlPath = join(webDir, 'index.html');

    try {
      await access(indexHtmlPath);
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
            req.method === 'GET' &&
            !hasExtension(req.path) &&
            !isApiPath(req.path) &&
            (req.headers.accept || '').includes('text/html')
          ) {
            return res.sendFile(indexHtmlPath);
          }
          return next();
        },
      );
    } catch {
      // index.html not found
    }
  } catch {
    // webDir not found
  }
}
