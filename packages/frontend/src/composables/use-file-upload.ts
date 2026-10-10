import { ref, computed } from 'vue';
import { uploadFile } from '@/api/files';
import type { RequestError } from '@vakao-ui/axios';

interface UploadItem {
  file: File;
  progress: number;
  error: boolean;
  errorMessage?: string;
  relativePath?: string;
}

export function useFileUpload(rootId: () => string) {
  const uploadItems = ref<UploadItem[]>([]);
  const isUploading = ref(false);

  const canUpload = computed(
    () =>
      uploadItems.value.length > 0 &&
      !uploadItems.value.some((f) => f.progress > 0 && f.progress < 100),
  );

  function addFiles(files: (File | { file: File; relativePath: string })[]) {
    files.forEach((item) => {
      const file = item instanceof File ? item : item.file;
      const relativePath = item instanceof File ? '' : item.relativePath;
      uploadItems.value.push({
        file,
        progress: 0,
        error: false,
        relativePath,
      });
    });
  }

  function removeItem(index: number) {
    uploadItems.value.splice(index, 1);
  }

  function clear() {
    uploadItems.value = [];
  }

  async function upload(category: string) {
    if (!uploadItems.value.length || !rootId()) return { success: 0, fail: 0 };

    isUploading.value = true;
    let successCount = 0;
    let failCount = 0;

    try {
      const promises = uploadItems.value.map((item, index) => {
        let finalCategory = category;
        if (item.relativePath) {
          finalCategory = category.endsWith('/')
            ? `${category}${item.relativePath}`
            : `${category}/${item.relativePath}`;
        }

        return uploadFile(rootId(), finalCategory, item.file, {
          onUploadProgress: (e) => {
            if (!e.total) return;
            const percent = (e.loaded / e.total) * 100;
            const currentItem = uploadItems.value[index];
            if (currentItem) {
              currentItem.progress = percent;
            }
          },
        })
          .then(() => {
            successCount++;
          })
          .catch((err: RequestError) => {
            failCount++;
            const currentItem = uploadItems.value[index];
            if (currentItem) {
              currentItem.error = true;
              currentItem.progress = 100;
              currentItem.errorMessage =
                err.type === 'http' && err.code === 413
                  ? '文件过大'
                  : err.message || '上传失败';
            }
          });
      });

      await Promise.all(promises);
    } finally {
      isUploading.value = false;
    }

    return { success: successCount, fail: failCount };
  }

  return {
    uploadItems,
    isUploading,
    canUpload,
    addFiles,
    removeItem,
    clear,
    upload,
  };
}
