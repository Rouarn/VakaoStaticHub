import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, access, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import sharp, { Sharp } from 'sharp';
import { getMimeTypeForFormat } from '#/common/utils/mime.util.js';

interface CacheManifest {
  [cacheFile: string]: { sourcePath: string; createdAt: number };
}

@Injectable()
export class ImageProcessorService {
  private readonly cacheDir: string;
  private readonly manifestPath: string;

  constructor(private readonly configService: ConfigService) {
    const fileRoot = this.configService.get<string>('files.root') ?? 'storage';
    this.cacheDir = resolve(fileRoot, '.cache', 'thumbnails');
    this.manifestPath = resolve(this.cacheDir, 'manifest.json');
  }

  async processImage(
    sourcePath: string,
    width?: number,
    height?: number,
    quality: number = 80,
    format: string = 'webp',
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const cacheKey = this.generateCacheKey(
      sourcePath,
      width,
      height,
      quality,
      format,
    );
    const cachedPath = resolve(this.cacheDir, `${cacheKey}.${format}`);

    try {
      await access(cachedPath);
      const buffer = await readFile(cachedPath);
      return { buffer, mimeType: getMimeTypeForFormat(format) };
    } catch {
      // Cache miss, process image
    }

    let pipeline = sharp(sourcePath);

    if (width || height) {
      pipeline = pipeline.resize(width, height, { fit: 'cover' });
    }

    pipeline = this.applyFormatAndQuality(pipeline, format, quality);

    const buffer = await pipeline.toBuffer();

    await mkdir(dirname(cachedPath), { recursive: true });
    await writeFile(cachedPath, buffer);
    await this.updateManifest(`${cacheKey}.${format}`, sourcePath);

    return { buffer, mimeType: getMimeTypeForFormat(format) };
  }

  private async updateManifest(cacheFile: string, sourcePath: string) {
    let manifest: CacheManifest = {};
    try {
      const raw = await readFile(this.manifestPath, 'utf-8');
      manifest = JSON.parse(raw) as CacheManifest;
    } catch {
      // manifest 不存在或损坏时重新创建
    }
    manifest[cacheFile] = { sourcePath, createdAt: Date.now() };
    await mkdir(this.cacheDir, { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  /** 供清理任务读取的缓存映射表 */
  async getManifest(): Promise<CacheManifest> {
    try {
      const raw = await readFile(this.manifestPath, 'utf-8');
      return JSON.parse(raw) as CacheManifest;
    } catch {
      return {};
    }
  }

  /** 清理任务调用：删除 manifest 中指定条目并移除缓存文件 */
  async removeCacheEntries(cacheFiles: string[]) {
    if (cacheFiles.length === 0) return;
    const manifest = await this.getManifest();
    for (const file of cacheFiles) {
      delete manifest[file];
      await rm(resolve(this.cacheDir, file), { force: true });
    }
    await writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  private generateCacheKey(
    path: string,
    width?: number,
    height?: number,
    quality?: number,
    format?: string,
  ): string {
    return createHash('sha1')
      .update(
        `${path}|${width || ''}|${height || ''}|${quality || ''}|${format || ''}`,
      )
      .digest('hex');
  }

  private applyFormatAndQuality(
    pipeline: Sharp,
    format: string,
    quality: number,
  ) {
    switch (format.toLowerCase()) {
      case 'webp':
        return pipeline.webp({ quality });
      case 'jpeg':
      case 'jpg':
        return pipeline.jpeg({ quality });
      case 'png':
        return pipeline.png({ quality: Math.round(quality / 10) });
      default:
        return pipeline.webp({ quality });
    }
  }
}
