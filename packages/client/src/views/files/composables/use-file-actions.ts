import { computed, ref } from 'vue';
import type { Ref } from 'vue';
import { useMessage } from 'naive-ui';
import type { FileItem, ShareLink } from '@vakao/shared';
import { batchDelete, batchMove, deleteFile, renameFile } from '@/api/files';
import { useOverviewStore } from '@/stores/modules/overview';
import {
  buildFilePreviewPageUrl,
  buildFileUrl,
  buildSharePageUrl,
  buildThumbUrl,
} from '@/utils/file-url';
import { isImage } from '@/utils/file-types';
import { fileVersion } from '@/utils/preview-source';
import { getErrorMessage } from '@/utils/http';
import type { PreviewTarget } from '@/components/preview/types';

/**
 * 文件库的单项/批量操作：预览、复制链接、重命名、移动、删除、上传回写与分享二维码。
 * 页面只负责列表加载与选择状态，操作成功后的刷新由调用方传入。
 */
export function useFileActions(options: {
  rootId: Ref<string>;
  category: Ref<string>;
  items: Ref<FileItem[]>;
  selected: Ref<Set<string>>;
  reload: () => Promise<void>;
  reloadCategories: () => void;
}) {
  const { rootId, category, items, selected, reload, reloadCategories } =
    options;
  const message = useMessage();
  const overview = useOverviewStore();

  // —— 预览 ——
  const previewShow = ref(false);
  const previewIndex = ref(0);
  const previewTargets = ref<PreviewTarget[]>([]);

  function toTarget(file: FileItem): PreviewTarget {
    return {
      filename: file.name,
      // 图片走高分辨率档，其余类型仍需原始内容交给各自的预览组件
      src: isImage(file.name)
        ? buildThumbUrl({ code: file.code }, 'preview')
        : buildFileUrl({ code: file.code }),
      downloadSrc: buildFileUrl({
        code: file.code,
        download: true,
      }),
      size: file.size,
      version: fileVersion(file.size, file.mtime),
    };
  }

  function openPreview(file: FileItem) {
    if (isImage(file.name)) {
      const images = items.value.filter((i) => isImage(i.name));
      previewTargets.value = images.map(toTarget);
      previewIndex.value = Math.max(
        0,
        images.findIndex((i) => i.path === file.path),
      );
    } else {
      previewTargets.value = [toTarget(file)];
      previewIndex.value = 0;
    }
    previewShow.value = true;
  }

  // —— 复制直链 ——
  async function copyLink(file: FileItem) {
    const url = buildFileUrl({ code: file.code });
    try {
      await navigator.clipboard.writeText(url);
      message.success('直链已复制');
    } catch {
      message.error('复制失败，请检查浏览器剪贴板权限');
    }
  }

  // —— 复制预览链接（带文件名，预览页据此选择播放器） ——
  async function copyPreviewLink(file: FileItem) {
    const url = buildFilePreviewPageUrl({ code: file.code, name: file.name });
    try {
      await navigator.clipboard.writeText(url);
      message.success('预览链接已复制');
    } catch {
      message.error('复制失败，请检查浏览器剪贴板权限');
    }
  }

  // —— 重命名 ——
  const renameShow = ref(false);
  const renameTarget = ref<FileItem | null>(null);
  const renameLoading = ref(false);

  function openRename(file: FileItem) {
    renameTarget.value = file;
    renameShow.value = true;
  }

  async function submitRename(newName: string) {
    const file = renameTarget.value;
    if (!file) return;
    renameLoading.value = true;
    try {
      await renameFile(rootId.value, category.value, file.path, newName);
      message.success('已重命名');
      renameShow.value = false;
      await reload();
      reloadCategories();
    } catch (e) {
      message.error(getErrorMessage(e, '重命名失败'));
    } finally {
      renameLoading.value = false;
    }
  }

  // —— 移动 ——
  const moveShow = ref(false);
  const movePaths = ref<string[]>([]);
  const moveLoading = ref(false);

  function openMove(file: FileItem) {
    movePaths.value = [file.path];
    moveShow.value = true;
  }

  function openBatchMove() {
    movePaths.value = [...selected.value];
    moveShow.value = true;
  }

  async function submitMove(targetCategory: string) {
    moveLoading.value = true;
    try {
      const result = await batchMove(
        rootId.value,
        category.value,
        movePaths.value,
        targetCategory,
      );
      const failed = result.results.filter((r) => !r.success);
      if (failed.length > 0) {
        message.warning(
          `已移动 ${result.movedCount} 个，${failed.length} 个失败：${failed[0].error ?? '未知原因'}`,
        );
      } else {
        message.success(
          `已移动 ${result.movedCount} 个文件到「${targetCategory}」`,
        );
      }
      moveShow.value = false;
      selected.value = new Set();
      await reload();
      reloadCategories();
    } catch (e) {
      message.error(getErrorMessage(e, '移动失败'));
    } finally {
      moveLoading.value = false;
    }
  }

  // —— 删除 ——
  const deleteShow = ref(false);
  const deletePaths = ref<string[]>([]);
  const deleteLabel = ref('');
  const deleteLoading = ref(false);

  function openDelete(file: FileItem) {
    deletePaths.value = [file.path];
    deleteLabel.value = `「${file.name}」`;
    deleteShow.value = true;
  }

  function openBatchDelete() {
    deletePaths.value = [...selected.value];
    deleteLabel.value = `${selected.value.size} 个文件`;
    deleteShow.value = true;
  }

  async function confirmDelete() {
    deleteLoading.value = true;
    try {
      if (deletePaths.value.length === 1) {
        await deleteFile(rootId.value, category.value, deletePaths.value[0]);
      } else {
        await batchDelete(rootId.value, category.value, deletePaths.value);
      }
      message.success(`${deleteLabel.value}已删除`);
      deleteShow.value = false;
      selected.value = new Set();
      await reload();
      reloadCategories();
    } catch (e) {
      message.error(getErrorMessage(e, '删除失败'));
    } finally {
      deleteLoading.value = false;
    }
  }

  // —— 上传 ——
  const uploadShow = ref(false);

  async function onUploaded() {
    await reload();
    reloadCategories();
  }

  // —— 分享（单文件 / 多选批量） ——
  const shareShow = ref(false);
  const sharePaths = ref<string[]>([]);

  function openShare(file: FileItem) {
    sharePaths.value = [file.path];
    shareShow.value = true;
  }

  function openBatchShare() {
    if (selected.value.size === 0) {
      message.warning('请先选择文件');
      return;
    }
    sharePaths.value = [...selected.value];
    shareShow.value = true;
  }

  // —— 创建成功后的二维码（与「分享管理」复用同一组件） ——
  const qrShow = ref(false);
  const qrUrl = ref('');
  const qrFilename = ref('');
  const shareLabel = computed(() =>
    sharePaths.value.length > 1
      ? `文件集合-${sharePaths.value.length}个`
      : (sharePaths.value[0]?.split('/').pop() ?? 'share'),
  );

  function onShareCreated(link: ShareLink) {
    // 单文件与多选批量都走这里：同步侧栏「分享管理」徽标，无需等路由切换
    void overview.refresh();
    qrUrl.value = buildSharePageUrl(link.token);
    qrFilename.value = `${shareLabel.value}-qr.png`;
    qrShow.value = true;
  }

  return {
    previewShow,
    previewIndex,
    previewTargets,
    openPreview,
    copyLink,
    copyPreviewLink,
    renameShow,
    renameTarget,
    renameLoading,
    openRename,
    submitRename,
    moveShow,
    movePaths,
    moveLoading,
    openMove,
    openBatchMove,
    submitMove,
    deleteShow,
    deletePaths,
    deleteLabel,
    deleteLoading,
    openDelete,
    openBatchDelete,
    confirmDelete,
    uploadShow,
    onUploaded,
    shareShow,
    sharePaths,
    openShare,
    openBatchShare,
    qrShow,
    qrUrl,
    qrFilename,
    onShareCreated,
  };
}
