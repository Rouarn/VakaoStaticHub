import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/** 解锁分享链接的请求体（无密码链接可省略） */
export class UnlockShareLinkDto {
  @ApiPropertyOptional({
    description: '分享密码；无密码链接可省略',
    example: '1234',
  })
  @IsOptional()
  @IsString()
  password?: string;
}

/**
 * 解锁成功后返回的分享访问令牌（统一信封的 data 段结构）
 * 令牌形态与有效期见 `@vakao/shared` 的 `ShareAccessGrant` 注释
 */
export class ShareAccessTokenDto {
  @ApiProperty({ description: '是否解锁成功', example: true })
  success!: boolean;

  @ApiProperty({
    description:
      '分享访问令牌。形态 `<issuedAt>.<hmac>`：issuedAt 为毫秒时间戳，' +
      'hmac 为 HMAC-SHA256(JWT_SECRET, `<shareToken>.<issuedAt>`) 的 64 位小写 hex；' +
      '仅对签发时的分享 token 有效，有效期 30 分钟；' +
      '后续请通过 query 参数 accessToken 传给 GET /share/:token 下载或预览。',
    example:
      '1730000000000.3f2a5c9e8b7d1f4a6c0e2b8d9f7a1c3e5b6d8f0a2c4e6b8d1f3a5c7e9b0d2f4a',
  })
  accessToken!: string;
}
