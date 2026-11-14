import type { DuplicateGroup } from '@vakao/shared';

/** 清理计划：一组内保留 1 个文件，其余进入删除清单 */
export interface CleanupPlan {
  group: DuplicateGroup;
  keep: { rootId: string; category: string; relPath: string; name: string };
  remove: { rootId: string; category: string; relPath: string }[];
}
