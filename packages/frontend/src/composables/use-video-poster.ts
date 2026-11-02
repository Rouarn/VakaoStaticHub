import { ref } from 'vue';

/**
 * 视频封面帧提取
 *
 * 卡片与预览都需要封面：加载 metadata 拿时长，seek 到 10% 处截帧到 canvas
 * 转 JPEG dataURL。跨域资源因画布污染会失败，此时保留渐变兜底背景。
 * 同一实例只提取一次，避免滚动列表时重复拉流。
 */
export function useVideoPoster() {
  const poster = ref('');
  const duration = ref(0);
  const loading = ref(false);
  let started = false;

  async function load(url: string) {
    if (started) return;
    started = true;
    loading.value = true;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('video load error'));
      });
      duration.value = Number.isFinite(video.duration) ? video.duration : 0;
      const seekTo = Math.max(0.1, Math.min(1, duration.value * 0.1));
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        try {
          video.currentTime = seekTo;
        } catch {
          resolve();
        }
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 480;
      canvas.height = video.videoHeight || 270;
      canvas
        .getContext('2d')
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster.value = canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      // 保留渐变兜底
    } finally {
      video.src = '';
      loading.value = false;
    }
  }

  return { poster, duration, loading, load };
}
