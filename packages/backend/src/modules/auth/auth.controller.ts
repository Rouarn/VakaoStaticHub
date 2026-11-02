import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { LoginResponse, UserInfo } from '@vakao/shared';
import { AuthService } from './auth.service.js';
import { TokenBlacklistService } from './token-blacklist.service.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { Public } from './decorators/public.decorator.js';
import { CurrentUser } from '#/common/decorators/current-user.decorator.js';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { getRequestMeta } from '#/utils/request-meta.util.js';

/**
 * 认证控制器
 * 处理用户注册、登录、令牌生成与当前用户信息
 */
@ApiTags('认证')
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenBlacklist: TokenBlacklistService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * 用户注册接口（仅已登录用户可用，用于管理员创建新账号）
   * 校验用户名唯一后创建用户
   */
  @Post('register')
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建新用户（需登录）' })
  @ApiBody({ type: RegisterDto, description: '注册信息' })
  async register(
    @Body() body: RegisterDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ): Promise<UserInfo> {
    const result = await this.authService.register(
      body.username,
      body.password,
      body.role ?? 'user',
      currentUser.userId,
    );
    // 审计：创建用户
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'user.register',
      resourceType: 'user',
      resourceId: String(result.id),
      details: { username: body.username, role: result.role },
      ...getRequestMeta(req),
    });
    return result;
  }

  /**
   * 用户登录接口
   * 验证用户名密码并返回 JWT 令牌
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: '用户登录' })
  @ApiBody({ type: LoginDto, description: '登录凭证' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(body.username, body.password);
    // 审计：用户登录
    this.auditLogService.log({
      userId: result.user.id,
      username: body.username,
      action: 'user.login',
      resourceType: 'user',
      resourceId: String(result.user.id),
      ...getRequestMeta(req),
    });
    return result;
  }

  /**
   * 获取当前登录用户信息
   */
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户信息' })
  async profile(
    @CurrentUser() currentUser: { userId: number; username: string },
  ): Promise<UserInfo> {
    const user = await this.authService.findById(currentUser.userId);
    if (!user) {
      throw new UnauthorizedException('用户不存在或已被删除');
    }
    return user;
  }

  /**
   * 退出登录（吊销当前 Token）
   */
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: '退出登录，吊销当前 Token' })
  logout(
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    if (!token) {
      throw new UnauthorizedException('未提供有效 Token');
    }

    // 解析 token 过期时间用于黑名单自动清理
    const payload = this.decodeJwtPayload(token);
    const expiresAt = payload?.exp
      ? payload.exp * 1000
      : Date.now() + 12 * 60 * 60 * 1000;
    this.tokenBlacklist.revoke(token, expiresAt);
    // 审计：用户登出
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'user.logout',
      resourceType: 'user',
      resourceId: String(currentUser.userId),
      ...getRequestMeta(req),
    });
    return { success: true };
  }

  private decodeJwtPayload(token: string): { exp?: number } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
      return JSON.parse(payload) as { exp?: number };
    } catch {
      return null;
    }
  }

  /**
   * 修改当前用户密码
   */
  @Patch('password')
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前登录用户的密码' })
  async changePassword(
    @CurrentUser() currentUser: { userId: number; username: string },
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    const result = await this.authService.changePassword(
      currentUser.userId,
      dto.oldPassword,
      dto.newPassword,
    );
    // 审计：修改密码
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'user.change_password',
      resourceType: 'user',
      resourceId: String(currentUser.userId),
      ...getRequestMeta(req),
    });
    return result;
  }

  /**
   * 获取用户列表
   */
  @Get('users')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取全部用户列表（不含密码哈希）' })
  async listUsers() {
    return await this.authService.listUsers();
  }

  /**
   * 管理员重置指定用户的密码
   */
  @Patch('users/:id/password')
  @ApiBearerAuth()
  @ApiOperation({ summary: '管理员重置指定用户密码' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  async resetUserPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.authService.resetPassword(
      currentUser.userId,
      id,
      dto.newPassword,
    );
    // 审计：重置密码
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'user.reset_password',
      resourceType: 'user',
      resourceId: String(id),
      ...getRequestMeta(req),
    });
    return result;
  }

  /**
   * 删除用户（禁止删除自己）
   */
  @Delete('users/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除指定用户' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  async deleteUser(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() currentUser: { userId: number; username: string },
    @Req() req: Request,
  ) {
    const result = await this.authService.deleteUser(id, currentUser.userId);
    // 审计：删除用户
    this.auditLogService.log({
      userId: currentUser.userId,
      username: currentUser.username,
      action: 'user.delete',
      resourceType: 'user',
      resourceId: String(id),
      ...getRequestMeta(req),
    });
    return result;
  }
}
