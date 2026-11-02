import { Controller, All } from '@nestjs/common';
import { Public } from '#/common/decorators/public.decorator.js';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('一言 hitokoto')
@Controller('hitokoto')
export class HitokotoController {
  @Public()
  @All('*path')
  @ApiOperation({ summary: '转发请求到 hitokoto 服务端' })
  proxy() {
    // 请求将被 HitokotoProxyMiddleware 拦截并转发
    // 此处保留方法仅为了 Swagger 文档生成
  }
}
