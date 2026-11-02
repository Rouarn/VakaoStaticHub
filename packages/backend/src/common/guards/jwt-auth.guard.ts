/**
 * JWT 认证守卫
 * 保护需要认证的接口，支持公开接口跳过认证
 */

import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * JWT 认证守卫类
 * 继承 Passport 的 AuthGuard，扩展支持 @Public() 装饰器
 * 被 @Public() 标记的接口将跳过认证检查
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  /**
   * 判断请求是否可以激活
   * 检查处理程序或控制器类是否标记为公开接口
   * @param context 执行上下文
   * @returns 是否允许访问
   */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
