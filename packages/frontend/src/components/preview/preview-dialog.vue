<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Component } from 'vue';
import { NButton, NIcon, NTooltip } from 'naive-ui';
import {
  CloseOutline,
  DownloadOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
  ExpandOutline,
  ContractOutline,
} from '@vicons/ionicons5';
import type { PreviewTarget } from './types';
import {
  resolvePreview,
  registerBuiltinPreviews,
} from '@/utils/preview-registry';
import { formatBytes, getFileKind } from '@/utils/file-types';
import DefaultPreview from './default-preview.vue';

/**
 * 预览弹窗：注册表分发 + 懒加载 + 上一张/下一张（图片集）+ 全屏
 *
 * 大文件策略：媒体类（图片/视频/音频）依赖 Range 或缩略图，可直接预览；
 * 文档类（PDF/Office/文本/压缩包）超过 120MB 时不自动解析，先提示再按需加载。
 */
const props = defineProps<{
  show: boolean;
  files: PreviewTarget[];
  index: number;
}>();

const emit = defineEmits<{
  'update:show': [boolean];
  'update:index': [number];
}>();

const DOC_LARGE_LIMIT = 120 * 1024 * 1024;

const component = shallowRef<Component | null>(null);
const loading = ref(false);
const failed = ref('');
const fullscreen = ref(false);
const bypassSizeGuard = ref(false);

const current = computed<PreviewTarget | undefined>(
  () => props.files[props.index],
);
const kind = computed(() => getFileKind(current.value?.filename ?? ''));
const isMedia = computed(() =>
  ['image', 'video', 'audio'].includes(kind.value),
);
const tooLarge = computed(
  () =>
    !isMedia.value &&
    (current.value?.size ?? 0) > DOC_LARGE_LIMIT &&
    !bypassSizeGuard.value,
);
const canPage = computed(
  () => kind.value === 'image' && props.files.length > 1,
);

async function load() {
  const target = current.value;
  if (!target) return;
  failed.value = '';
  component.value = null;
  loading.value = true;
  try {
    const loader = resolvePreview(target.filename);
    component.value = loader ? await loader() : DefaultPreview;
  } catch (e) {
    failed.value = e instanceof Error ? e.message : '预览组件加载失败';
  } finally {
    loading.value = false;
  }
}

registerBuiltinPreviews();

watch(
  () => [props.show, props.index] as const,
  ([show, index], old) => {
    if (!show) {
      component.value = null;
      return;
    }
    // 切换条目时重置尺寸守卫与全屏
    if (!old || old[1] !== index) {
      bypassSizeGuard.value = false;
      fullscreen.value = false;
    }
    if (tooLarge.value) {
      component.value = null;
      loading.value = false;
      return;
    }
    void load();
  },
  { immediate: true },
);

function close() {
  emit('update:show', false);
}

function prev() {
  emit(
    'update:index',
    (props.index - 1 + props.files.length) % props.files.length,
  );
}
function next() {
  emit('update:index', (props.index + 1) % props.files.length);
}

function onKey(e: KeyboardEvent) {
  if (!props.show) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft' && canPage.value) prev();
  else if (e.key === 'ArrowRight' && canPage.value) next();
}
window.addEventListener('keydown', onKey);
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

function forcePreview() {
  bypassSizeGuard.value = true;
  void load();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade-in">
      <div
        v-if="props.show"
        class="fixed inset-0 z-100 flex items-center justify-center bg-black/45 backdrop-blur-sm"
        @click.self="close"
      >
        <div
          class="glass-panel flex flex-col overflow-hidden transition-all duration-300"
          :style="
            fullscreen
              ? { width: '100vw', height: '100vh', borderRadius: '0' }
              : { width: '92vw', height: '88vh' }
          "
        >
          <!-- 头部 -->
          <header
            class="flex items-center gap-3 px-4 py-3 border-b border-glass-border dark:border-glass-border-dark shrink-0"
          >
            <div class="min-w-0">
              <p class="m-0 text-13px font-600 text-ink truncate">
                {{ current?.filename }}
              </p>
              <p class="m-0 text-11px text-ink-sub">
                {{ formatBytes(current?.size ?? 0) }}
                <span v-if="canPage">
                  · {{ props.index + 1 }} / {{ props.files.length }}</span
                >
              </p>
            </div>
            <div class="ml-auto flex items-center gap-1">
              <!-- trigger 必须是单节点：条件渲染放在 Tooltip 上，避免 v-if 产生空 trigger -->
              <NTooltip v-if="canPage" :delay="300"
                ><template #trigger>
                  <NButton size="small" quaternary circle @click="prev">
                    <template #icon
                      ><NIcon><ChevronBackOutline /></NIcon
                    ></template>
                  </NButton> </template
                >上一张</NTooltip
              >
              <NTooltip v-if="canPage" :delay="300"
                ><template #trigger>
                  <NButton size="small" quaternary circle @click="next">
                    <template #icon
                      ><NIcon><ChevronForwardOutline /></NIcon
                    ></template>
                  </NButton> </template
                >下一张</NTooltip
              >
              <NTooltip :delay="300"
                ><template #trigger>
                  <NButton
                    size="small"
                    quaternary
                    circle
                    @click="fullscreen = !fullscreen"
                  >
                    <template #icon>
                      <NIcon>
                        <ContractOutline v-if="fullscreen" />
                        <ExpandOutline v-else />
                      </NIcon>
                    </template>
                  </NButton> </template
                >{{ fullscreen ? '退出全屏' : '全屏' }}</NTooltip
              >
              <NTooltip v-if="current" :delay="300"
                ><template #trigger>
                  <NButton
                    tag="a"
                    :href="current.downloadSrc"
                    download
                    size="small"
                    quaternary
                    circle
                  >
                    <template #icon
                      ><NIcon><DownloadOutline /></NIcon
                    ></template>
                  </NButton> </template
                >下载</NTooltip
              >
              <NButton size="small" quaternary circle @click="close">
                <template #icon
                  ><NIcon><CloseOutline /></NIcon
                ></template>
              </NButton>
            </div>
          </header>

          <!-- 内容区 -->
          <div class="flex-1 min-h-0 p-4">
            <div
              v-if="tooLarge"
              class="h-full flex flex-col items-center justify-center gap-3"
            >
              <p class="m-0 text-13px text-ink-sub">
                文件较大（{{
                  formatBytes(current?.size ?? 0)
                }}），已跳过自动预览以避免占用内存
              </p>
              <NButton type="primary" size="small" @click="forcePreview">
                仍要预览
              </NButton>
            </div>
            <div
              v-else-if="failed"
              class="h-full flex items-center justify-center text-13px text-ink-sub"
            >
              {{ failed }}
            </div>
            <div
              v-else-if="loading"
              class="h-full flex items-center justify-center text-13px text-ink-sub"
            >
              加载中…
            </div>
            <component
              :is="component"
              v-else-if="component && current"
              :key="current.src"
              :src="current.src"
              :filename="current.filename"
              :size="current.size"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
