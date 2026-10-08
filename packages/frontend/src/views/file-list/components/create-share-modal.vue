<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  NModal,
  NButton,
  NSelect,
  NInputGroup,
  NInputGroupLabel,
  NSpace,
  NInput,
  NTag,
  NIcon,
  useMessage,
} from 'naive-ui';
import { DownloadOutline } from '@vicons/ionicons5';
import { createShareLink, getShareLinkUrl } from '@/api/share';
import QrCode from '@/components/qr-code.vue';
import { useFileListStore } from '@/stores/modules/file-list';

const props = defineProps<{
  visible: boolean;
  /** 单文件分享时的文件路径 */
  filePath?: string;
  /** 多文件分享时的文件路径列表 */
  filePaths?: string[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const message = useMessage();
const store = useFileListStore();

const loading = ref(false);
const createdToken = ref('');
const qrCodeRef = ref<{ save: () => void } | null>(null);

function saveQrCode() {
  qrCodeRef.value?.save();
}

const expireOptions = [
  { label: '永不过期', value: 0 },
  { label: '1 小时', value: 3600000 },
  { label: '24 小时', value: 86400000 },
  { label: '7 天', value: 604800000 },
  { label: '30 天', value: 2592000000 },
];
const selectedExpire = ref(0);

const accessLimitOptions = [
  { label: '不限制', value: 0 },
  { label: '1 次', value: 1 },
  { label: '5 次', value: 5 },
  { label: '10 次', value: 10 },
  { label: '50 次', value: 50 },
  { label: '100 次', value: 100 },
];
const selectedAccessLimit = ref(0);

/** 访问密码，留空表示不设置 */
const password = ref('');

const isCollection = computed(
  () => props.filePaths !== undefined && props.filePaths.length > 0,
);

function close() {
  createdToken.value = '';
  password.value = '';
  emit('close');
}

async function handleCreate() {
  loading.value = true;
  try {
    const params: {
      rootId: string;
      category: string;
      filePath: string;
      shareType?: 'file' | 'collection';
      filePaths?: string[];
      expiresInMs?: number;
      maxAccesses?: number;
      password?: string;
    } = {
      rootId: store.currentRootId,
      category: store.currentCategory,
      filePath: isCollection.value ? props.filePaths![0] : props.filePath!,
      expiresInMs: selectedExpire.value || undefined,
      maxAccesses: selectedAccessLimit.value || undefined,
      password: password.value || undefined,
    };

    if (isCollection.value) {
      params.shareType = 'collection';
      params.filePaths = props.filePaths;
    }

    const data = await createShareLink(params);
    createdToken.value = data.token;
    message.success('分享链接已创建');
  } catch (error: any) {
    message.error(error.response?.data?.message || '创建失败');
  } finally {
    loading.value = false;
  }
}

function copyLink() {
  const url = getShareLinkUrl(createdToken.value);
  navigator.clipboard.writeText(url).then(
    () => message.success('链接已复制到剪贴板'),
    () => message.error('复制失败'),
  );
}
</script>

<template>
  <NModal
    :show="props.visible"
    preset="card"
    title="创建分享链接"
    :mask-closable="true"
    style="max-width: 480px"
    @update:show="
      (value) => {
        if (!value) close();
      }
    "
  >
    <div class="space-y-4">
      <div v-if="isCollection">
        <div class="text-sm text-gray-500 mb-2">
          共 {{ props.filePaths!.length }} 个文件
        </div>
        <div class="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
          <NTag
            v-for="path in props.filePaths"
            :key="path"
            size="small"
            class="max-w-full"
            :title="path"
          >
            <span class="truncate max-w-[200px]">{{ path }}</span>
          </NTag>
        </div>
      </div>
      <div
        v-else
        class="text-sm text-gray-500 truncate"
        :title="props.filePath"
      >
        文件：{{ props.filePath }}
      </div>

      <template v-if="!createdToken">
        <div>
          <div class="text-sm font-medium mb-2">过期时间</div>
          <NInputGroup>
            <NInputGroupLabel>有效期</NInputGroupLabel>
            <NSelect v-model:value="selectedExpire" :options="expireOptions" />
          </NInputGroup>
        </div>

        <div>
          <div class="text-sm font-medium mb-2">打开次数限制</div>
          <NInputGroup>
            <NInputGroupLabel>最大次数</NInputGroupLabel>
            <NSelect
              v-model:value="selectedAccessLimit"
              :options="accessLimitOptions"
            />
          </NInputGroup>
          <div class="mt-1 text-xs text-gray-400">
            链接每被成功打开一次计 1 次；打开后下载其中文件不再计数
          </div>
        </div>

        <div>
          <div class="text-sm font-medium mb-2">访问密码（可选）</div>
          <NInput
            v-model:value="password"
            type="password"
            show-password-on="click"
            placeholder="留空则不设置密码"
            clearable
          />
        </div>
      </template>

      <template v-else>
        <div class="space-y-3">
          <div class="text-sm text-green-600 font-medium">分享链接已创建</div>
          <div class="text-xs text-gray-400 break-all">
            {{ getShareLinkUrl(createdToken) }}
          </div>
          <QrCode
            ref="qrCodeRef"
            :value="getShareLinkUrl(createdToken)"
            :size="200"
            label="分享链接二维码"
            save-name="vakao-share"
            mode="plain"
            :show-save-button="false"
          />
        </div>
      </template>
    </div>

    <template #footer>
      <NSpace justify="end" :wrap="false">
        <NButton @click="close">{{ createdToken ? '关闭' : '取消' }}</NButton>
        <template v-if="createdToken">
          <NButton type="primary" @click="copyLink"> 复制链接 </NButton>
          <NButton type="success" @click="saveQrCode">
            <template #icon>
              <NIcon :component="DownloadOutline" />
            </template>
            保存二维码
          </NButton>
        </template>
        <NButton v-else type="primary" :loading="loading" @click="handleCreate">
          创建链接
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
