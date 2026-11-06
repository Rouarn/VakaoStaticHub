import { http } from '@/utils/http';
import type { LoginResponse, RegisterParams, UserInfo } from '@vakao/shared';

interface ServerUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  createdAt: string;
  updatedAt: string;
}

interface ServerLoginResponse {
  token: string;
  tokenType: string;
  expiresAt: string;
  user: ServerUser;
}

function toUserInfo(user: ServerUser): UserInfo {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: new Date(user.createdAt).getTime(),
  };
}

export function toUserInfoList(users: ServerUser[]): UserInfo[] {
  return users.map(toUserInfo);
}

export async function login(username: string, password: string) {
  const result = await http.post<ServerLoginResponse>('/auth/login', {
    username,
    password,
  } satisfies RegisterParams);
  const expiresInSeconds = Math.max(
    0,
    Math.round((new Date(result.expiresAt).getTime() - Date.now()) / 1000),
  );
  return {
    accessToken: result.token,
    tokenType: 'Bearer',
    expiresIn: `${expiresInSeconds}s`,
    user: toUserInfo(result.user),
  } satisfies LoginResponse;
}

export async function logout() {
  await http.post('/auth/logout', {});
  return { success: true as const };
}

export async function getProfile() {
  const user = await http.get<ServerUser>('/auth/me');
  return toUserInfo(user);
}
