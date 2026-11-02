import type { UserInfo, UserRole } from '@vakao/shared';
import { http } from '@/utils/http';

/** 用户列表（后端一次性返回全部，账号数量很少，页面按客户端分页展示） */
export function listUsers() {
  return http.get<UserInfo[]>('/auth/users');
}

/** 创建账号（需登录；创建 admin 仅管理员可操作，由后端权威校验） */
export function createUser(
  username: string,
  password: string,
  role: UserRole = 'user',
) {
  return http.post<UserInfo>('/auth/register', { username, password, role });
}

/** 删除用户（后端权威校验：不能删自己、至少保留一个管理员） */
export function deleteUser(id: number) {
  return http.delete<{ success: boolean }>(`/auth/users/${id}`);
}

/** 修改当前登录用户密码 */
export function changeMyPassword(oldPassword: string, newPassword: string) {
  return http.patch<{ success: boolean }>('/auth/password', {
    oldPassword,
    newPassword,
  });
}

/** 管理员重置他人密码（后端校验操作者必须是 admin 且不能重置自己） */
export function resetUserPassword(id: number, newPassword: string) {
  return http.patch<{ success: boolean }>(`/auth/users/${id}/password`, {
    newPassword,
  });
}
