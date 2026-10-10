<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { NIcon, NButton, NSpin, NEmpty, NInput } from 'naive-ui';
import {
  DocumentOutline,
  DownloadOutline,
  LinkOutline,
  LockClosedOutline,
} from '@vicons/ionicons5';
import { getShareInfo, unlockShare, getShareFileUrl } from '@/api/share';
import { getErrorMessage } from '@/utils/request';

defineOptions({ name: 'share-access' });

/** 与后端访问令牌有效期（30 分钟）对齐，本地新鲜度判断预留 60 秒余量 */
const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

const route = useRoute();

const loading = ref(true);
const verifying = ref(false);
const error = ref('');
const verifyError = ref('');
const shareType = ref<'file' | 'collection'>('file');
const category = ref('');
const files = ref<string[]>([]);
const hasPassword = ref(false);
const password = ref('');
const accessToken = ref('');
const token = computed(() => route.params.token as string);
const storageKey = computed(() => `share-access-token:${token.value}`);

/** 令牌本地是否仍在有效期内（前端无法验签，仅按签发时间戳判断） */
function isTokenFresh(value: string) {
  const timestamp = Number(value.split('.')[0]);
  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp < ACCESS_TOKEN_TTL_MS - TOKEN_SAFETY_MARGIN_MS
  );
}

function saveAccessToken(value: string) {
  accessToken.value = value;
  sessionStorage.setItem(storageKey.value, value);
}

function clearAccessToken() {
  accessToken.value = '';
  sessionStorage.removeItem(storageKey.value);
}

function getFileDownloadUrl(index: number) {
  const url = getShareFileUrl(token.value, accessToken.value || undefined);
  return `${url}${url.includes('?') ? '&' : '?'}index=${index}&download=1`;
}

/**
 * 解锁分享链接（消耗一次打开次数）
 * 单文件解锁成功后直接跳转预览/下载；多文件停留在列表页
 */
async function unlock(passwordText?: string) {
  const res = await unlockShare(token.value, passwordText);
  saveAccessToken(res.accessToken);
  if (shareType.value === 'file') {
    window.location.href = getShareFileUrl(token.value, res.accessToken);
  }
}

/** 下载前确保持有有效令牌；令牌过期时无密码自动重新解锁，有密码回到密码框 */
async function ensureUnlocked() {
  if (accessToken.value && isTokenFresh(accessToken.value)) return true;
  if (!hasPassword.value) {
    try {
      await unlock();
      return true;
    } catch (e) {
      error.value = getErrorMessage(e, '解锁分享链接失败');
      return false;
    }
  }
  clearAccessToken();
  verifyError.value = '访问已过期，请重新输入访问密码';
  return false;
}

async function downloadFile(index: number) {
  if (!(await ensureUnlocked())) return;
  const url = getFileDownloadUrl(index);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', '');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function loadShareInfo() {
  loading.value = true;
  error.value = '';
  try {
    const info = await getShareInfo(token.value);
    hasPassword.value = info.hasPassword;
    shareType.value = info.shareType;
    category.value = info.category || '';
    files.value = info.filePaths || [];

    // 优先复用本会话已解锁的令牌：30 分钟内刷新/回看不再消耗打开次数
    const saved = sessionStorage.getItem(storageKey.value);
    if (saved) {
      if (isTokenFresh(saved)) {
        accessToken.value = saved;
        if (shareType.value === 'file') {
          window.location.href = getShareFileUrl(token.value, saved);
        }
        return;
      }
      sessionStorage.removeItem(storageKey.value);
    }

    // 无密码链接：打开页面即自动解锁（计数一次），之后下载不再计数
    if (!hasPassword.value) {
      await unlock();
    }
  } catch (e) {
    error.value = getErrorMessage(e, '加载分享信息失败');
  } finally {
    loading.value = false;
  }
}

async function verifyPassword() {
  if (!password.value) return;
  verifying.value = true;
  verifyError.value = '';
  try {
    await unlock(password.value);
  } catch (e) {
    verifyError.value = getErrorMessage(e, '密码验证失败');
  } finally {
    verifying.value = false;
  }
}

onMounted(() => {
  loadShareInfo();
});
</script>

<template>
  <div
    class="h-full overflow-hidden bg-base flex flex-col items-center justify-center p-8"
  >
    <div class="w-full max-w-md flex flex-col">
      <div class="text-center mb-6 shrink-0">
        <NIcon size="48" class="text-primary mb-3 block mx-auto">
          <LinkOutline />
        </NIcon>
        <h1 class="text-xl font-semibold text-base mb-1">文件分享</h1>
        <p v-if="category" class="text-sm text-gray-500">{{ category }}</p>
      </div>

      <div v-if="loading" class="flex justify-center py-12">
        <NSpin size="large" />
      </div>

      <div v-else-if="error" class="text-center py-8">
        <NEmpty :description="error" />
      </div>

      <!-- 需要密码验证 -->
      <template v-else-if="hasPassword && !accessToken">
        <div
          class="bg-container rounded-xl shadow-sm border border-base p-6 space-y-4"
        >
          <div class="flex items-center gap-2 text-base">
            <NIcon size="20" class="text-primary"><LockClosedOutline /></NIcon>
            <span>该分享受密码保护</span>
          </div>
          <NInput
            v-model:value="password"
            type="password"
            placeholder="请输入访问密码"
            size="large"
            @keydown.enter="verifyPassword"
          />
          <p v-if="verifyError" class="text-sm text-red-500 m-0">
            {{ verifyError }}
          </p>
          <NButton
            type="primary"
            size="large"
            block
            :loading="verifying"
            @click="verifyPassword"
          >
            验证密码
          </NButton>
        </div>
      </template>

      <template v-else-if="shareType === 'collection'">
        <div
          class="share-file-list bg-container rounded-xl shadow-sm border border-base overflow-y-auto no-scrollbar"
        >
          <div
            v-for="(filePath, index) in files"
            :key="filePath"
            class="flex items-center gap-3 px-4 py-3 border-b border-base last:border-b-0 hover:bg-base/50 transition-colors"
          >
            <NIcon size="20" class="text-gray-400 shrink-0">
              <DocumentOutline />
            </NIcon>
            <span class="flex-1 text-sm text-base truncate" :title="filePath">
              {{ filePath }}
            </span>
            <NButton
              size="small"
              type="primary"
              ghost
              @click="downloadFile(index)"
            >
              <template #icon>
                <NIcon><DownloadOutline /></NIcon>
              </template>
              下载
            </NButton>
          </div>
        </div>
        <div class="mt-4 text-center text-xs text-gray-400 shrink-0">
          共 {{ files.length }} 个文件
        </div>
      </template>

      <div v-else class="text-center py-8 text-sm text-gray-500">
        正在跳转下载...
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 文件列表：确定的视口高度约束，保证文件很多时仅列表内部滚动；
   高度 = 视口 - 外层 padding(3rem) - 标题区(~9rem) - 底部统计(~2.5rem) */
.share-file-list {
  max-height: calc(100vh - 14.5rem);
  max-height: calc(100dvh - 14.5rem);
}

/* 隐藏滚动条但保留滚动能力 */
.no-scrollbar {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
