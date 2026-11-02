/**
 * 用户实体
 * 存储管理后台的登录账号，密码以 scrypt 加盐哈希形式保存（永不存明文）
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'users' })
@Index(['username'], { unique: true })
export class UserEntity {
  /** 主键 ID，自增 */
  @PrimaryGeneratedColumn()
  id!: number;

  /** 登录用户名，全局唯一，仅允许字母数字下划线连字符 */
  @Column({ type: 'varchar', length: 32 })
  username!: string;

  /** 密码哈希，格式 scrypt$<saltHex>$<hashHex> */
  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** 角色：admin 管理员 / user 普通用户 */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  role!: 'admin' | 'user';

  /** 创建时间戳（毫秒） */
  @Column({ type: 'integer' })
  createdAt!: number;

  /** 更新时间戳（毫秒） */
  @Column({ type: 'integer' })
  updatedAt!: number;
}
