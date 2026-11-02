import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { UserInfo, UserRole } from '@vakao/shared';
import { UserEntity } from '#/infra/database/entities/user.entity.js';
import { hashPassword } from '../auth/utils/password.util.js';

/**
 * 用户服务
 * 负责 users 表的数据访问与用户管理（列表 / 重置密码 / 删除用户）
 */
@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
  ) {}

  /** 按用户名查询用户（含密码哈希，仅供凭证校验使用） */
  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.userRepo.findOne({ where: { username } });
  }

  /** 按 ID 查询用户（含密码哈希，仅供密码校验使用） */
  async findByIdWithSecret(id: number): Promise<UserEntity | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  /** 按 ID 查询对外用户信息 */
  async findById(id: number): Promise<UserInfo | null> {
    const user = await this.findByIdWithSecret(id);
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
    const user = await this.findByIdWithSecret(id);
    return user
      ? {
          id: user.id,
          username: user.username,
          role: user.role,
          passwordChangedAt: user.updatedAt,
        }
      : null;
  }

  /** 创建用户并返回对外信息 */
  async createUser(
    username: string,
    passwordHash: string,
    role: UserRole,
  ): Promise<UserInfo> {
    const now = Date.now();
    const user = this.userRepo.create({
      username,
      passwordHash,
      role,
      createdAt: now,
      updatedAt: now,
    });
    const saved = await this.userRepo.save(user);
    this.logger.log(`新用户注册成功: ${username} (id=${saved.id})`);
    return this.toUserInfo(saved);
  }

  /** 更新指定用户的密码哈希与更新时间（用于改密/重置密码） */
  async updatePassword(id: number, passwordHash: string): Promise<void> {
    const user = await this.findByIdWithSecret(id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    user.passwordHash = passwordHash;
    user.updatedAt = Date.now();
    await this.userRepo.save(user);
  }

  /** 获取全部用户列表（不含密码哈希，按创建时间升序） */
  async listUsers(): Promise<UserInfo[]> {
    const users = await this.userRepo.find({ order: { createdAt: 'ASC' } });
    return users.map((u) => this.toUserInfo(u));
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
    const user = await this.findByIdWithSecret(targetId);
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

  /**
   * 删除用户
   * 后端权威校验：不能删自己；至少保留一个管理员。
   */
  async deleteUser(id: number, currentUserId: number) {
    if (id === currentUserId) {
      throw new BadRequestException('不能删除当前登录用户');
    }
    const target = await this.findByIdWithSecret(id);
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
  async assertAdmin(
    actorId: number | undefined,
    message: string,
  ): Promise<void> {
    if (!actorId) {
      throw new ForbiddenException(message);
    }
    const actor = await this.findByIdWithSecret(actorId);
    if (!actor || actor.role !== 'admin') {
      throw new ForbiddenException(message);
    }
  }

  /** 实体转换为对外用户信息（不含密码哈希） */
  toUserInfo(user: UserEntity): UserInfo {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
