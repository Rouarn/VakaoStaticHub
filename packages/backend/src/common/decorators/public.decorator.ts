/**
 * 公开接口装饰器
 * 用于标记无需认证即可访问的接口
 */

import { SetMetadata } from '@nestjs/common';

/** 元数据键名，用于标识公开接口 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 公开接口装饰器函数
 * 将被装饰的处理程序标记为公开访问，跳过 JWT 认证守卫
 * @example
 * @Public()
 * @Get('public-data')
 * getPublicData() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
