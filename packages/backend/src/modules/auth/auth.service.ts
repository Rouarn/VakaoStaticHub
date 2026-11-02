import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import type { LoginResponse, UserInfo, UserRole } from '@vakao/shared';
import { UserEntity } from '#/infra/database/entities/user.entity.js';
import { UserService } from '../users/user.service.js';
import { hashPassword, verifyPassword } from './utils/password.util.js';

/**
 * 认证服务
 * 负责登录、注册、当前用户信息与密码修改，用户数据访问委托 UserService
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
  ) {}

  /**
   * 注册新用户（由已登录用户创建，不签发令牌，新用户需自行登录）
   * @param username 用户名
   * @param password 明文密码
   * @param role 目标角色；仅管理员可以创建管理员
   * @param actorId 当前操作人
   */
  async register(
    username: string,
    password: string,
    role: UserRole = 'user',
    actorId?: number,
  ): Promise<UserInfo> {
    if (role === 'admin') {
      await this.userService.assertAdmin(actorId, '仅管理员可以创建管理员账号');
    }
    const existing = await this.userService.findByUsername(username);
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    return await this.userService.createUser(
      username,
      await hashPassword(password),
      role,
    );
  }

  /**
   * 校验用户名密码并生成令牌
   * @param username 用户名
   * @param password 密码
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    return this.issueToken(user);
  }

  /** 按 ID 查询用户信息，供个人信息接口使用 */
  async findById(id: number): Promise<UserInfo | null> {
    return this.userService.findById(id);
  }

  /** 按 ID 查询认证信息，供 JWT 策略校验 token 时效 */
  async findAuthInfo(id: number) {
    return this.userService.findAuthInfo(id);
  }

  /** 用户修改自己的密码 */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.userService.findByIdWithSecret(userId);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('当前密码错误');
    }
    await this.userService.updatePassword(
      userId,
      await hashPassword(newPassword),
    );
    this.logger.log(`用户 ${user.username} (id=${userId}) 修改密码成功`);
    return { success: true };
  }

  /** 签发 JWT 并组装登录响应 */
  private async issueToken(user: UserEntity): Promise<LoginResponse> {
    const expiresIn = (this.configService.get<string>('auth.jwtExpiresIn') ??
      '12h') as JwtSignOptions['expiresIn'];

    const accessToken = await this.jwtService.signAsync(
      { sub: String(user.id), username: user.username },
      { expiresIn },
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: String(expiresIn),
      user: this.userService.toUserInfo(user),
    };
  }
}
