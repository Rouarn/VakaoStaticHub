import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '#/infra/database/entities/user.entity.js';
import { UserService } from './user.service.js';

/** 用户模块：提供 users 表的数据访问与用户管理能力 */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity])],
  providers: [UserService],
  exports: [UserService],
})
export class UsersModule {}
