import { request } from '../utils/request';
import type { LoginResponse, RegisterParams, UserInfo } from '@vakao/shared';

export function login(username: string, password: string) {
  return request.post<LoginResponse>('/auth/login', {
    username,
    password,
  } satisfies RegisterParams);
}

export function register(username: string, password: string) {
  return request.post<UserInfo>('/auth/register', {
    username,
    password,
  } satisfies RegisterParams);
}

export function getProfile() {
  return request.get<UserInfo>('/auth/profile');
}

/** 退出登录，吊销当前 Token */
export function logout() {
  return request.post<{ success: true }>('/auth/logout');
}

/** 修改当前用户密码 */
export function changePassword(oldPassword: string, newPassword: string) {
  return request.patch<{ success: true }>('/auth/password', {
    oldPassword,
    newPassword,
  });
}

/** 获取用户列表 */
export function listUsers() {
  return request.get<UserInfo[]>('/auth/users');
}

/** 删除用户 */
export function deleteUser(id: number) {
  return request.delete<{ success: true }>(`/auth/users/${id}`);
}
