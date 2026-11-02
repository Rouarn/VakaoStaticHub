import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { LoginResponse, UserInfo, UserRole } from '@vakao/shared';
import { UserEntity } from '#/infra/database/entities/user.entity.js';
import { hashPassword, verifyPassword } from './utils/password.util.js';

/**
 * 认证服务
 * 基于 users 表完成用户注册、凭证校验和 JWT 签发
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
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
      await this.assertAdmin(actorId, '仅管理员可以创建管理员账号');
    }
    const existing = await this.userRepo.findOne({ where: { username } });
    if (existing) {
      throw new ConflictException('用户名已存在');
    }

    const now = Date.now();
    const user = this.userRepo.create({
      username,
      passwordHash: await hashPassword(password),
      role,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.userRepo.save(user);
    this.logger.log(`新用户注册成功: ${username} (id=${saved.id})`);

    return this.toUserInfo(saved);
  }

  /**
   * 校验用户名密码并生成令牌
   * @param username 用户名
   * @param password 密码
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    return this.issueToken(user);
  }

  /** 按 ID 查询用户信息，供 JWT 策略与个人信息接口使用 */
  async findById(id: number): Promise<UserInfo | null> {
    const user = await this.userRepo.findOne({ where: { id } });
    return user ? this.toUserInfo(user) : null;
  }

  /**
   * 按 ID 查询认证信息（含密码最后修改时间），供 JWT 策略校验 token 时效
   * updatedAt 目前仅在创建用户与修改密码时更新，可作为 passwordChangedAt 使用
   */
  async findAuthInfo(id: number): Promise<{
    id: number;
    username: string;
    role: UserRole;
    passwordChangedAt: number;
  } | null> {
    const user = await this.userRepo.findOne({ where: { id } });
    return user
      ? {
          id: user.id,
          username: user.username,
          role: user.role,
          passwordChangedAt: user.updatedAt,
        }
      : null;
  }

  /** 用户修改自己的密码 */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('当前密码错误');
    }
    user.passwordHash = await hashPassword(newPassword);
    user.updatedAt = Date.now();
    await this.userRepo.save(user);
    this.logger.log(`用户 ${user.username} (id=${userId}) 修改密码成功`);
    return { success: true };
  }

  /**
   * 管理员重置他人密码（后端权威校验调用者角色）
   * 目标账号存在、不能是操作人自己（自己改密走 PATCH /auth/password 校验旧密码）
   */
  async resetPassword(
    actorId: number | undefined,
    targetId: number,
    newPassword: string,
  ) {
    await this.assertAdmin(actorId, '仅管理员可以重置他人密码');
    if (actorId === targetId) {
      throw new BadRequestException('请使用「修改我的密码」修改自己的密码');
    }
    const user = await this.userRepo.findOne({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    user.passwordHash = await hashPassword(newPassword);
    user.updatedAt = Date.now();
    await this.userRepo.save(user);
    this.logger.log(
      `管理员 id=${actorId} 重置用户 ${user.username} (id=${targetId}) 的密码`,
    );
    return { success: true };
  }

  /** 获取全部用户列表（不含密码哈希） */
  async listUsers() {
    const users = await this.userRepo.find({ order: { createdAt: 'ASC' } });
    return users.map((u) => this.toUserInfo(u));
  }

  /**
   * 删除用户
   * 后端权威校验：不能删自己；至少保留一个管理员。
   */
  async deleteUser(id: number, currentUserId: number) {
    if (id === currentUserId) {
      throw new BadRequestException('不能删除当前登录用户');
    }
    const target = await this.userRepo.findOne({ where: { id } });
    if (!target) {
      throw new NotFoundException('用户不存在');
    }
    if (target.role === 'admin') {
      const adminCount = await this.userRepo.count({
        where: { role: 'admin' },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('至少保留一个管理员账号');
      }
    }
    await this.userRepo.delete({ id });
    this.logger.log(`用户 id=${id} 已被删除`);
    return { success: true };
  }

  /** 校验指定用户是管理员，否则抛 403 */
  private async assertAdmin(actorId: number | undefined, message: string) {
    if (!actorId) {
      throw new ForbiddenException(message);
    }
    const actor = await this.userRepo.findOne({ where: { id: actorId } });
    if (!actor || actor.role !== 'admin') {
      throw new ForbiddenException(message);
    }
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
      user: this.toUserInfo(user),
    };
  }

  private toUserInfo(user: UserEntity): UserInfo {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
