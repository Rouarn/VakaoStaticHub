import { http } from '@/utils/http';
import type { LoginResponse, RegisterParams, UserInfo } from '@vakao/shared';

export function login(username: string, password: string) {
  return http.post<LoginResponse>('/auth/login', {
    username,
    password,
  } satisfies RegisterParams);
}

export function logout() {
  return http.post<{ success: true }>('/auth/logout');
}

export function getProfile() {
  return http.get<UserInfo>('/auth/profile');
}
