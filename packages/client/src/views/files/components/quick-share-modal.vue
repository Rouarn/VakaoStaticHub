<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
} from 'naive-ui';
import { createShare } from '@/api/shares';
import { getErrorMessage } from '@/utils/http';
import type { ShareLink } from '@vakao/shared';

/**
 * 快速创建分享弹窗（从文件库「更多 → 创建分享」或多选批量创建）。
 *
 * - 单文件：shareType=file
 * - 多文件：shareType=collection，filePaths=所选路径
 */
const props = defineProps<{
  show: boolean;
  rootId: string;
  category: string;
  paths: string[];
}>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  /** 创建成功：交给父级统一弹出二维码（复用 ShareQrModal） */
  created: [link: ShareLink];
}>();

const isCollection = computed(() => props.paths.length > 1);
const fileName = computed(() => {
  if (props.paths.length === 0) return '';
  if (props.paths.length === 1)
    return props.paths[0].split('/').pop() ?? props.paths[0];
  return `文件集合（${props.paths.length} 个文件）`;
});

const remark = ref('');
const expiresPreset = ref(0);
const customHours = ref(24);
const maxAccesses = ref<number | null>(null);
const requirePassword = ref(false);
const password = ref('');
const busy = ref(false);
const error = ref('');

const expiryOptions = [
  { label: '永久有效', value: 0 },
  { label: '1 小时', value: 1 },
  { label: '1 天', value: 24 },
  { label: '7 天', value: 168 },
  { label: '30 天', value: 720 },
  { label: '自定义', value: -1 },
];

function reset() {
  remark.value = '';
  expiresPreset.value = 0;
  customHours.value = 24;
  maxAccesses.value = null;
  requirePassword.value = false;
  password.value = '';
  busy.value = false;
  error.value = '';
}

watch(
  () => props.show,
  (v) => {
    if (v) reset();
  },
);

function close() {
  emit('update:show', false);
}

async function submit() {
  if (props.paths.length === 0) {
    error.value = '没有可分享的文件';
    return;
  }
  const preset = expiresPreset.value;
  const expiresInMs =
    preset > 0
      ? preset * 3_600_000
      : preset === -1
        ? customHours.value * 3_600_000
        : undefined;
  if (preset === -1 && (!customHours.value || customHours.value <= 0)) {
    error.value = '自定义有效期必须大于 0 小时';
    return;
  }
  if (requirePassword.value && !password.value.trim()) {
    error.value = '已勾选「需要密码」，请填写访问密码';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const link = await createShare({
      rootId: props.rootId,
      category: props.category,
      filePaths: props.paths,
      ...(remark.value.trim() ? { remark: remark.value.trim() } : {}),
      ...(expiresInMs ? { expiresInMs } : {}),
      ...(maxAccesses.value ? { maxAccesses: maxAccesses.value } : {}),
      ...(requirePassword.value && password.value.trim()
        ? { password: password.value.trim() }
        : {}),
    });
    close();
    emit('created', link);
  } catch (e) {
    error.value = getErrorMessage(e, '创建分享失败');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    @update:show="emit('update:show', $event)"
    preset="card"
    :title="isCollection ? `创建多文件分享（${paths.length} 个）` : '创建分享'"
    style="width: 480px"
    :mask-closable="false"
  >
    <div class="flex flex-col gap-3">
      <div class="glass-card px-3 py-2">
        <p class="m-0 text-12px text-ink-sub">目标分类</p>
        <p class="m-0 text-13px font-600 text-ink truncate">
          {{ rootId }} / {{ category }}
        </p>
        <p class="m-0 text-12px text-ink-sub truncate">{{ fileName }}</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-11px text-ink-sub">备注（可选）</label>
        <NInput
          v-model:value="remark"
          size="small"
          placeholder="仅自己可见的备注"
        />
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-11px text-ink-sub">有效期</label>
        <NSelect
          v-model:value="expiresPreset"
          size="small"
          :options="expiryOptions"
          class="w-36"
        />
        <NInputNumber
          v-if="expiresPreset === -1"
          v-model:value="customHours"
          size="small"
          :min="1"
          placeholder="小时"
          style="width: 110px"
        />
      </div>

      <div class="flex items-center gap-3 flex-wrap">
        <label class="text-11px text-ink-sub">最大访问次数</label>
        <NInputNumber
          v-model:value="maxAccesses"
          size="small"
          :min="1"
          placeholder="不限制"
          style="width: 140px"
        />
      </div>

      <div class="flex flex-col gap-1">
        <NCheckbox v-model:checked="requirePassword" size="small">
          需要密码
        </NCheckbox>
        <NInput
          v-if="requirePassword"
          v-model:value="password"
          size="small"
          type="password"
          show-password-on="click"
          placeholder="请输入访问密码"
        />
      </div>

      <p v-if="error" class="m-0 text-12px text-red-500">{{ error }}</p>

      <div class="flex justify-end gap-2 pt-1">
        <NButton size="small" quaternary @click="close">取消</NButton>
        <NButton size="small" type="primary" :loading="busy" @click="submit">
          创建分享
        </NButton>
      </div>
    </div>
  </NModal>
</template>
