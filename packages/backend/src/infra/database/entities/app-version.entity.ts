/**
 * APP 版本实体
 * 存储安卓安装包版本的元数据，支撑多应用的在线更新、发布与下架
 *
 * 存储结构：software-update 资源根（与 storage 同级）下按应用分目录——
 *   software-update/{appKey}/v{versionCode}_{versionName}.apk
 * appKey 即 software-update 根下的资源分类（如 xiaolv、xiaolan），每个应用独立维护版本序列
 */

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 版本状态：0 草稿 / 1 灰度 / 2 全量 / 3 已下架 */
export const VERSION_STATUS = {
  DRAFT: 0,
  GRAY: 1,
  PUBLISHED: 2,
  OFFLINE: 3,
} as const;

@Entity({ name: 'app_versions' })
@Index(['platform', 'appKey', 'versionCode'], { unique: true })
export class AppVersionEntity {
  /** 主键 ID，自增 */
  @PrimaryGeneratedColumn()
  id!: number;

  /** 平台，当前仅 android */
  @Column({ type: 'varchar', length: 16, default: 'android' })
  platform!: string;

  /** 应用标识（software-update 资源根下的分类目录名，如 xiaolv / xiaolan） */
  @Column({ type: 'varchar', length: 64 })
  appKey!: string;

  /** 展示用版本名，如 1.0.1 */
  @Column({ type: 'varchar', length: 32 })
  versionName!: string;

  /** 核心比较字段，整数版本号，在同一应用内单调递增 */
  @Column({ type: 'integer' })
  versionCode!: number;

  /** 更新类型，当前仅 apk 整包 */
  @Column({ type: 'varchar', length: 8, default: 'apk' })
  updateType!: string;

  /** 包体大小（字节），上传后服务端自动计算 */
  @Column({ type: 'integer' })
  packageSize!: number;

  /** 包体 SHA-256 校验值（64 位十六进制），上传后自动计算 */
  @Column({ type: 'varchar', length: 64 })
  checksum!: string;

  /** 存储资源根目录 ID（软件更新专用根，与 storage 同级） */
  @Column({ type: 'varchar', length: 64, default: 'software-update' })
  storageRootId!: string;

  /** 所属应用目录名（等于 appKey） */
  @Column({ type: 'varchar', length: 64 })
  category!: string;

  /** 应用目录下的文件名，含版本号防覆盖，如 v101_1.0.1.apk */
  @Column({ type: 'varchar', length: 255 })
  relPath!: string;

  /** 更新说明，换行分行 */
  @Column({ type: 'text', nullable: true })
  updateLog!: string | null;

  /** 强更开关 0/1，可远程随时修改（逃生口） */
  @Column({ type: 'integer', default: 0 })
  forceUpdate!: number;

  /** 最低兼容版本号，客户端低于此值一律按强更处理 */
  @Column({ type: 'integer', default: 0 })
  minVersionCode!: number;

  /** 灰度百分比 0~100，status=1 时生效 */
  @Column({ type: 'integer', default: 0 })
  grayPercent!: number;

  /** 灰度自动递增开关 0/1，status=1 时生效 */
  @Column({ type: 'integer', default: 0 })
  grayAutoIncrement!: number;

  /** 灰度递增时间表 JSON：[{ "hours": 24, "percent": 30 }, ...]，percent 达 100 自动转全量 */
  @Column({ type: 'text', nullable: true })
  grayIncrementSchedule!: string | null;

  /** 定时发布时间戳（毫秒），仅草稿生效，到点自动发布 */
  @Column({ type: 'integer', nullable: true })
  scheduledPublishAt!: number | null;

  /** 定时发布模式：full 全量 / gray 灰度 */
  @Column({ type: 'varchar', length: 8, default: 'full' })
  scheduledPublishMode!: string;

  /** 定时灰度发布的灰度百分比 1~99 */
  @Column({ type: 'integer', default: 0 })
  scheduledGrayPercent!: number;

  /** 状态：0 草稿 / 1 灰度 / 2 全量 / 3 已下架 */
  @Column({ type: 'integer', default: 0 })
  status!: number;

  /**
   * 下架原因（仅 status=3 OFFLINE 时有效）：
   *   null    从未全量发布过的版本被下架（非正常状态，仅防御）
   *   auto    被新全量 publish 自动挤掉的历史版本（可作为 rollback 候选恢复）
   *   manual  管理员手动止血下架（不可被 rollback 自动恢复）
   * 这个字段让 rollback 能区分"应该能回滚的自动下架"和"不应该恢复的人工止血"。
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  offlineReason!: 'auto' | 'manual' | null;

  /** 发布时间戳（毫秒） */
  @Column({ type: 'integer', nullable: true })
  publishTime!: number | null;

  /** 内部备注 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  remark!: string | null;

  /** 创建时间戳（毫秒） */
  @Column({ type: 'integer' })
  createdAt!: number;

  /** 更新时间戳（毫秒） */
  @Column({ type: 'integer' })
  updatedAt!: number;
}
