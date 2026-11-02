import { defineStore } from 'pinia';
import type { LoginResponse, UserInfo } from '@vakao/shared';

/**
 * 认证状态：JWT + 当前用户，持久化到 localStorage。
 * 401 由 utils/http.ts 统一捕获：清空登录态并跳转登录页（带 redirect 回跳）。
 */
export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: '',
    user: null as UserInfo | null,
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.accessToken),
  },
  actions: {
    setAuth(payload: LoginResponse) {
      this.accessToken = payload.accessToken;
      this.user = payload.user;
    },
    clearAuth() {
      this.accessToken = '';
      this.user = null;
    },
  },
  persist: true,
});
