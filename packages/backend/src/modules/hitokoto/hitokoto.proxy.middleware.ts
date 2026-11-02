import {
  Injectable,
  NestMiddleware,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import type { RequestHandler } from 'express';
import type { ClientRequest } from 'http';
import type { Socket } from 'net';

@Injectable()
export class HitokotoProxyMiddleware implements NestMiddleware, OnModuleInit {
  private readonly logger = new Logger(HitokotoProxyMiddleware.name);
  private proxy: RequestHandler | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const target =
      this.configService.get<string>('HITOKOTO_API_URL') ||
      process.env.HITOKOTO_API_URL ||
      '';

    if (!target) {
      this.logger.warn('Hitokoto 代理目标未配置，代理已禁用');
      return;
    }

    this.logger.log(`Hitokoto 代理中间件初始化，目标: ${target}`);

    const { createProxyMiddleware } = await import('http-proxy-middleware');

    this.proxy = createProxyMiddleware({
      target,
      changeOrigin: true,
      // 上游 10 秒无响应则断开，交由 error 回调返回 502，
      // 避免上游不可达时前端请求一直挂起
      timeout: 10_000,
      pathRewrite: {
        '^/static/hitokoto': '',
      },
      on: {
        proxyReq: (proxyReq: ClientRequest, req: Request) => {
          const source = req.originalUrl || req.url;
          const hostHeader = proxyReq.getHeader('host');
          const host =
            typeof hostHeader === 'string' ? hostHeader : proxyReq.host;
          const targetUrl = `${proxyReq.protocol}//${host}${proxyReq.path}`;
          this.logger.log(
            `请求代理: [${req.method}] ${source} -> ${targetUrl}`,
          );

          const body = req.body as Record<string, unknown> | undefined;
          if (
            body &&
            typeof body === 'object' &&
            Object.keys(body).length > 0
          ) {
            const bodyData = JSON.stringify(body);
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
          }
        },
        error: (
          err: Error,
          _req: Request,
          res: (Response & { headersSent?: boolean }) | Socket,
        ) => {
          // Node 双栈连接（autoSelectFamily）失败时会抛出 message 为空的
          // AggregateError，真正的原因在 errors[] 中
          const innerErrors =
            'errors' in err &&
            Array.isArray((err as { errors: unknown[] }).errors)
              ? (err as { errors: Error[] }).errors
                  .map((e) => e.message)
                  .join('; ')
              : '';
          const detail = err.message || innerErrors || '未知错误';
          const code =
            'code' in err && typeof (err as { code: unknown }).code === 'string'
              ? (err as { code: string }).code
              : err.name;
          this.logger.error(`代理错误 [${code}]: ${detail}`);
          if (
            res &&
            typeof res === 'object' &&
            'headersSent' in res &&
            !res.headersSent &&
            'status' in res &&
            typeof res.status === 'function'
          ) {
            res.status(502).json({
              statusCode: 502,
              message: 'Bad Gateway - 代理错误',
              error: detail,
            });
          }
        },
      },
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    if (!this.proxy) {
      // 未配置代理目标时返回明确的错误码与文案，便于前端提示“代理未启用”，
      // 而不是 404（容易被误判成路由不存在）
      res.status(503).json({
        statusCode: 503,
        code: 'HITOKOTO_PROXY_DISABLED',
        message: '一言代理未启用：未配置 HITOKOTO_API_URL',
      });
      return;
    }

    void this.proxy(req, res, next);
  }
}
