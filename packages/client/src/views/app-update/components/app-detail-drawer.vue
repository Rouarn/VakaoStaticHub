<script setup lang="ts">
import { ref, watch } from 'vue';
import { NButton, NDrawer, NDrawerContent, NIcon, NSpin, NTag } from 'naive-ui';
import { DocumentTextOutline } from '@vicons/ionicons5';
import {
  APP_VERSION_STATUS,
  STATUS_META,
  getApkDownloadUrl,
  getVersion,
} from '@/api/app-update';
import type { AppVersionRecord } from '@/api/app-update';
import { getErrorMessage } from '@/utils/http';
import { formatBytes } from '@/utils/file-types';
import { formatDateTime } from '@/utils/format';

/** 版本详情抽屉：打开时按 id 拉取最新详情，失败保留概要并提示 */
const props = defineProps<{
  show: boolean;
  version: AppVersionRecord | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
}>();

const detailLoading = ref(false);
const detailError = ref('');
const detail = ref<AppVersionRecord | null>(null);

function statusMetaOf(version: AppVersionRecord) {
  return STATUS_META[version.status] ?? STATUS_META[0];
}

function offlineReasonLabel(version: AppVersionRecord) {
  if (version.status !== APP_VERSION_STATUS.OFFLINE) return '';
  if (version.offlineReason === 'auto') return '自动下架';
  if (version.offlineReason === 'manual') return '手动下架';
  return '下架原因未知';
}

watch(
  () => [props.show, props.version] as const,
  ([show, version]) => {
    if (!show || !version) return;
    void loadDetail(version);
  },
  { immediate: true },
);

async function loadDetail(version: AppVersionRecord) {
  detailLoading.value = true;
  detailError.value = '';
  detail.value = version;
  try {
    detail.value = await getVersion(version.id);
  } catch (e) {
    detailError.value = getErrorMessage(e, '版本详情加载失败');
  } finally {
    detailLoading.value = false;
  }
}
</script>

<template>
  <NDrawer
    :show="show"
    width="min(440px, 92vw)"
    placement="right"
    @update:show="emit('update:show', $event)"
  >
    <NDrawerContent title="版本详情" closable>
      <NSpin :show="detailLoading">
        <p v-if="detailError" class="m-0 text-12px text-red-500">
          {{ detailError }}
        </p>
        <div v-else-if="detail" class="flex flex-col gap-4">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-14px font-600 text-ink">
              {{ detail.appKey }} · v{{ detail.versionName }}
            </span>
            <NTag
              size="small"
              :type="statusMetaOf(detail).tag"
              :bordered="false"
            >
              {{ statusMetaOf(detail).label }}
            </NTag>
            <NTag
              v-if="detail.forceUpdate === 1"
              size="small"
              type="error"
              :bordered="false"
              >强制更新</NTag
            >
          </div>

          <dl class="m-0 grid grid-cols-[86px_1fr] gap-x-3 gap-y-2 text-12px">
            <dt class="text-ink-sub">平台</dt>
            <dd class="m-0 text-ink">{{ detail.platform }}</dd>

            <dt class="text-ink-sub">版本号</dt>
            <dd class="m-0 text-ink tabular-nums">
              {{ detail.versionCode }}
            </dd>

            <dt class="text-ink-sub">包大小</dt>
            <dd class="m-0 text-ink">
              {{ formatBytes(detail.packageSize) }}
            </dd>

            <dt class="text-ink-sub">SHA-256</dt>
            <dd class="m-0 text-ink font-mono text-11px break-all">
              {{ detail.checksum }}
            </dd>

            <dt class="text-ink-sub">存储位置</dt>
            <dd class="m-0 text-ink break-all">
              {{ detail.storageRootId }} / {{ detail.category }} /
              {{ detail.relPath }}
            </dd>

            <dt class="text-ink-sub">发布时间</dt>
            <dd class="m-0 text-ink">
              {{ formatDateTime(detail.publishTime) }}
            </dd>

            <dt class="text-ink-sub">强制更新</dt>
            <dd class="m-0 text-ink">
              {{
                detail.forceUpdate === 1
                  ? `是（最低版本号 ${detail.minVersionCode}）`
                  : '否'
              }}
            </dd>

            <dt class="text-ink-sub">灰度</dt>
            <dd class="m-0 text-ink">
              {{
                detail.status === APP_VERSION_STATUS.GRAY
                  ? `${detail.grayPercent}%${detail.grayAutoIncrement === 1 ? ' · 自动递增' : ''}`
                  : '—'
              }}
            </dd>

            <dt class="text-ink-sub">定时发布</dt>
            <dd class="m-0 text-ink">
              <template v-if="detail.scheduledPublishAt">
                {{ formatDateTime(detail.scheduledPublishAt) }}（{{
                  detail.scheduledPublishMode === 'gray'
                    ? `灰度 ${detail.scheduledGrayPercent}%`
                    : '全量'
                }}）
              </template>
              <template v-else>—</template>
            </dd>

            <dt class="text-ink-sub">下架原因</dt>
            <dd class="m-0 text-ink">
              {{ offlineReasonLabel(detail) || '—' }}
            </dd>

            <dt class="text-ink-sub">创建时间</dt>
            <dd class="m-0 text-ink">
              {{ formatDateTime(detail.createdAt) }}
            </dd>

            <dt class="text-ink-sub">更新时间</dt>
            <dd class="m-0 text-ink">
              {{ formatDateTime(detail.updatedAt) }}
            </dd>
          </dl>

          <div>
            <p class="m-0 mb-1 text-11px text-ink-sub">更新日志</p>
            <p class="m-0 text-12px text-ink whitespace-pre-wrap">
              {{ detail.updateLog || '—' }}
            </p>
          </div>

          <div v-if="detail.remark">
            <p class="m-0 mb-1 text-11px text-ink-sub">备注</p>
            <p class="m-0 text-12px text-ink whitespace-pre-wrap">
              {{ detail.remark }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <NButton
              tag="a"
              :href="getApkDownloadUrl(detail.id)"
              target="_blank"
              rel="noreferrer"
              size="small"
            >
              <template #icon
                ><NIcon><DocumentTextOutline /></NIcon
              ></template>
              下载 APK
            </NButton>
            <NButton size="small" @click="emit('update:show', false)"
              >关闭</NButton
            >
          </div>
        </div>
      </NSpin>
    </NDrawerContent>
  </NDrawer>
</template>
