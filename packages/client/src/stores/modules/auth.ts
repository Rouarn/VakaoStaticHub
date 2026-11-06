import { defineStore } from 'pinia';
import type { LoginResponse, UserInfo } from '@vakao/shared';
import { STORAGE_KEYS, piniaStorage } from '@/utils/storage';

/**
 * 认证状态：JWT + 当前用户，持久化到 `vakao:auth`。
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
    setUser(user: UserInfo) {
      this.user = user;
    },
    clearAuth() {
      this.accessToken = '';
      this.user = null;
    },
  },
  persist: {
    key: STORAGE_KEYS.auth,
    storage: piniaStorage,
  },
});
