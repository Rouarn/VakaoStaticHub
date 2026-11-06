/**
 * 浏览器本地存储的唯一入口。
 *
 * 所有 key 统一 `vakao:` 前缀并集中登记，业务代码通过这里的读写封装访问，
 * 不再直接出现字符串 key。旧版本 key 只在 migrateLegacyStorage 中处理一次。
 */

export const STORAGE_KEYS = {
  /** Pinia app store：主题、当前根目录与分类、侧边栏展开状态 */
  app: 'vakao:app',
  /** Pinia auth store：登录令牌与用户信息 */
  auth: 'vakao:auth',
  /** 一言工具的历史记录 */
  hitokotoHistory: 'vakao:hitokoto:history',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 旧版本 key：只用于首次迁移，迁移完成后删除 */
const LEGACY_STORAGE_KEYS = {
  app: 'app',
  auth: 'auth',
  fileSelection: 'vakao:file-selection',
  hitokotoHistory: 'vakao.hitokoto.history.v1',
} as const;

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // 隐私模式或存储被禁用时按无数据处理
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 写入失败不影响当前会话
  }
}

function removeRaw(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 删除失败无需中断业务流程
  }
}

export function readStorage(key: StorageKey): string | null {
  return readRaw(key);
}

export function writeStorage(key: StorageKey, value: string): void {
  writeRaw(key, value);
}

export function removeStorage(key: StorageKey): void {
  removeRaw(key);
}

/** 读取并反序列化 JSON；内容损坏时按无数据处理 */
export function readJson<T>(key: StorageKey): T | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(key: StorageKey, value: unknown): void {
  writeRaw(key, JSON.stringify(value));
}

/** Pinia 持久化插件的适配器，保证插件的读写同样走统一封装 */
export const piniaStorage = {
  getItem: (key: string): string | null => readRaw(key),
  setItem: (key: string, value: string): void => writeRaw(key, value),
};

function parseRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 旧 key 到新 key 的一次性衔接。
 *
 * 必须在应用启动、Pinia store 首次读取之前调用。新 key 已存在时以新 key
 * 为准；否则把旧值原样搬过去，并把旧的分类记录（根目录 + 分类）合并进
 * app 状态。迁移完成后删除全部旧 key，内存中只保留一套 `vakao:` key。
 */
export function migrateLegacyStorage(): void {
  const legacyApp = parseRecord(readRaw(LEGACY_STORAGE_KEYS.app));
  const legacySelection = parseRecord(
    readRaw(LEGACY_STORAGE_KEYS.fileSelection),
  );

  if (readRaw(STORAGE_KEYS.app) === null) {
    const merged: Record<string, unknown> = { ...(legacyApp ?? {}) };
    const rootId = legacySelection?.rootId;
    const category = legacySelection?.category;
    // 分类必须连同所属根目录一起还原，缺一不可
    if (
      typeof rootId === 'string' &&
      rootId &&
      typeof category === 'string' &&
      category
    ) {
      merged.activeRootId = rootId;
      merged.activeCategory = category;
    }
    if (Object.keys(merged).length > 0) {
      writeRaw(STORAGE_KEYS.app, JSON.stringify(merged));
    }
  }

  if (readRaw(STORAGE_KEYS.auth) === null) {
    const legacyAuth = readRaw(LEGACY_STORAGE_KEYS.auth);
    if (legacyAuth !== null) writeRaw(STORAGE_KEYS.auth, legacyAuth);
  }

  if (readRaw(STORAGE_KEYS.hitokotoHistory) === null) {
    const legacyHistory = readRaw(LEGACY_STORAGE_KEYS.hitokotoHistory);
    if (legacyHistory !== null) {
      writeRaw(STORAGE_KEYS.hitokotoHistory, legacyHistory);
    }
  }

  Object.values(LEGACY_STORAGE_KEYS).forEach((key) => removeRaw(key));
}
