/**
 * 登录与当前账号接口。
 *
 * 服务端返回的令牌字段是 token + 绝对过期时间，这里统一转成
 * LoginResponse：expiresIn 由剩余秒数计算，仅用于展示与本地判断，
 * 真正的失效由服务端令牌校验决定。
 */
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

/** 把服务端用户记录批量转成前端模型（时间转为毫秒） */
export function toUserInfoList(users: ServerUser[]): UserInfo[] {
  return users.map(toUserInfo);
}

/**
 * 账号密码登录。用户名不存在与密码错误返回同一错误文案，
 * 调用方无需也不应区分。
 */
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

/** 服务端只记审计，令牌由前端丢弃；失败也不影响本地清态 */
export async function logout() {
  await http.post('/auth/logout', {});
  return { success: true as const };
}

/** 读取当前令牌对应的最新用户资料（角色可能已被管理员调整） */
export async function getProfile() {
  const user = await http.get<ServerUser>('/auth/me');
  return toUserInfo(user);
}
