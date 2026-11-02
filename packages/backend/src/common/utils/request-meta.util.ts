/**
 * 请求元信息提取工具
 * 用于审计日志等场景统一获取客户端 IP 与 User-Agent
 */

import type { Request } from 'express';

/**
 * 从请求中提取客户端 IP 与 User-Agent
 * IP 优先取 x-forwarded-for 首个地址（兼容反向代理），否则取 req.ip
 */
export function getRequestMeta(req: Request): {
  ip: string | null;
  userAgent: string | null;
} {
  const forwarded = (req.headers['x-forwarded-for'] as string) ?? '';
  const ip = forwarded.split(',')[0]?.trim() || req.ip || null;
  const userAgent = (req.headers['user-agent'] as string) ?? null;
  return { ip, userAgent };
}
