<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  NButton,
  NDatePicker,
  NInput,
  NInputNumber,
  NModal,
  NSwitch,
  useMessage,
} from 'naive-ui';
import type { ShareLink, UpdateShareLinkParams } from '@vakao/shared';
import { updateShare } from '@/api/shares';
import { getErrorMessage } from '@/utils/http';

/** 编辑分享链接：备注 / 有效期 / 次数上限 / 密码 / 启停，仅提交变化字段 */
const props = defineProps<{
  show: boolean;
  link: ShareLink | null;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  saved: [];
}>();

const message = useMessage();

const editSaving = ref(false);
const editForm = ref({
  remark: '',
  expiresAt: null as number | null,
  password: '',
  clearPassword: false,
  maxAccesses: null as number | null,
  enabled: true,
});

watch(
  () => [props.show, props.link] as const,
  ([show, link]) => {
    if (!show || !link) return;
    editForm.value = {
      remark: link.remark ?? '',
      expiresAt: link.expiresAt,
      password: '',
      clearPassword: false,
      maxAccesses: link.maxAccesses,
      enabled: link.enabled,
    };
  },
  { immediate: true },
);

async function submitEdit() {
  const target = props.link;
  if (!target) return;
  const next = editForm.value;
  const body: UpdateShareLinkParams = {};

  const remark = next.remark.trim() || null;
  if (remark !== (target.remark ?? null)) body.remark = remark;
  // 仅在发生变化时提交，避免把已过期的历史时间原样回传被后端拒绝
  if (next.expiresAt !== target.expiresAt) body.expiresAt = next.expiresAt;
  if (next.maxAccesses !== target.maxAccesses)
    body.maxAccesses = next.maxAccesses;
  if (next.enabled !== target.enabled) body.enabled = next.enabled;
  if (next.clearPassword) body.password = null;
  else if (next.password.trim()) body.password = next.password.trim();

  if (Object.keys(body).length === 0) {
    message.info('没有修改内容');
    emit('update:show', false);
    return;
  }

  editSaving.value = true;
  try {
    await updateShare(target.token, body);
    message.success('分享链接已更新');
    emit('update:show', false);
    emit('saved');
  } catch (e) {
    message.error(getErrorMessage(e, '更新分享链接失败'));
  } finally {
    editSaving.value = false;
  }
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="编辑分享链接"
    class="w-620px! max-w-[94vw]"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-11px text-ink-sub font-mono break-all">
        {{ link?.token }}
      </p>

      <label class="flex flex-col gap-1">
        <span class="text-12px text-ink-sub">备注（仅后台可见）</span>
        <NInput
          v-model:value="editForm.remark"
          size="small"
          maxlength="255"
          clearable
          placeholder="留空则清除备注"
        />
      </label>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">有效期（清空为永久）</span>
          <NDatePicker
            v-model:value="editForm.expiresAt"
            size="small"
            type="datetime"
            clearable
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">最大打开次数（留空不限制）</span>
          <NInputNumber
            v-model:value="editForm.maxAccesses"
            size="small"
            :min="1"
            :max="1000000"
            clearable
            placeholder="不限制"
          />
        </label>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-12px text-ink-sub">
            新访问密码{{
              link?.hasPassword ? '（留空则保留原密码）' : '（可选）'
            }}
          </span>
          <NInput
            v-model:value="editForm.password"
            size="small"
            type="password"
            show-password-on="click"
            :disabled="editForm.clearPassword"
            placeholder="输入新密码"
          />
        </label>
        <div class="flex flex-col gap-2 justify-center">
          <div class="flex items-center gap-2">
            <NSwitch v-model:value="editForm.clearPassword" size="small" />
            <span class="text-12px text-ink-sub">清除访问密码</span>
          </div>
          <div class="flex items-center gap-2">
            <NSwitch v-model:value="editForm.enabled" size="small" />
            <span class="text-12px text-ink-sub">启用链接</span>
          </div>
        </div>
      </div>

      <p class="m-0 text-11px text-ink-sub">
        停用后公开访问返回「分享链接已停用」（HTTP
        410），不会误报为不存在；重新启用即可恢复。
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <NButton size="small" @click="emit('update:show', false)">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :loading="editSaving"
          @click="submitEdit"
        >
          保存
        </NButton>
      </div>
    </template>
  </NModal>
</template>
