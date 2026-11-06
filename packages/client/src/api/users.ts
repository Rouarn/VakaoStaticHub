import type { UserRole } from '@vakao/shared';
import { http } from '@/utils/http';
import { toUserInfoList } from '@/api/auth';

interface ServerUser {
  id: number;
  username: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

/** 用户列表（后端一次性返回全部，账号数量很少，页面按客户端分页展示） */
export async function listUsers() {
  const page = await http.get<{
    items: ServerUser[];
    total: number;
    page: number;
    pageSize: number;
  }>('/users', { page: 1, pageSize: 200 });
  return toUserInfoList(page.items);
}

/** 创建账号（需登录；创建 admin 仅管理员可操作，由后端权威校验） */
export async function createUser(
  username: string,
  password: string,
  role: UserRole = 'user',
) {
  const user = await http.post<ServerUser>('/users', {
    username,
    password,
    role,
  });
  return toUserInfoList([user])[0];
}

/** 删除用户（后端权威校验：不能删自己、至少保留一个管理员） */
export async function deleteUser(id: number) {
  await http.delete(`/users/${id}`);
  return { success: true };
}

/** 修改当前登录用户密码 */
export async function changeMyPassword(
  oldPassword: string,
  newPassword: string,
) {
  await http.patch('/auth/password', { oldPassword, newPassword });
  return { success: true };
}

/** 管理员重置他人密码（后端校验操作者必须是 admin 且不能重置自己） */
export async function resetUserPassword(id: number, newPassword: string) {
  await http.patch(`/users/${id}/password`, { password: newPassword });
  return { success: true };
}
