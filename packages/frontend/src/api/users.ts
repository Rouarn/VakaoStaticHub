import type { UserInfo } from '@vakao/shared';
import { http } from '@/utils/http';

/** 用户列表（后端一次性返回全部，无分页参数） */
export function listUsers() {
  return http.get<UserInfo[]>('/auth/users');
}

/** 创建账号（需登录，后端用户名唯一校验） */
export function createUser(username: string, password: string) {
  return http.post<UserInfo>('/auth/register', { username, password });
}

/** 删除用户（后端禁止删除当前登录用户） */
export function deleteUser(id: number) {
  return http.delete<{ success: boolean }>(`/auth/users/${id}`);
}

/** 修改当前登录用户密码（后端未提供管理员重置他人密码的接口） */
export function changeMyPassword(oldPassword: string, newPassword: string) {
  return http.patch<{ success: boolean }>('/auth/password', {
    oldPassword,
    newPassword,
  });
}
