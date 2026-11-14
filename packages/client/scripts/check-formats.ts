/**
 * 构建前格式一致性校验
 *
 * 主表 EXT_META 是唯一事实来源，预览器注册与 MIME 反查都由它派生。
 * 这里在构建前把派生结果反查一遍，避免以后新增格式时只改一处：
 * - 每个类别都有已注册的预览器（通用兜底 other 除外）
 * - 每条 MIME 至少有一个代表扩展名，且同一 MIME 不能有两个代表扩展名
 * - MIME 反查结果必须落在主表内，且类别一致
 * - 每个扩展名都能解析出预览器
 * - 扩展名归一化（大小写/点号）行为正确
 */
import {
  EXT_META,
  extensionFromContentType,
  getExtension,
  getFileKind,
  normalizeExtension,
} from '@/utils/file-types';
import {
  registerBuiltinPreviews,
  registeredPreviewKinds,
  resolvePreview,
} from '@/utils/preview-registry';

const issues: string[] = [];

const entries = Object.entries(EXT_META);

for (const [ext, meta] of entries) {
  if (!ext || ext !== normalizeExtension(ext)) {
    issues.push(`扩展名键未归一化：${JSON.stringify(ext)}`);
  }
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(meta.mime)) {
    issues.push(`MIME 格式非法：${ext} → ${meta.mime}`);
  }
}

const kinds = new Set(entries.map(([, meta]) => meta.kind));

registerBuiltinPreviews();
const registered = new Set(registeredPreviewKinds());
for (const kind of kinds) {
  if (!registered.has(kind)) issues.push(`类别缺少预览器注册：${kind}`);
}
for (const kind of registered) {
  if (!kinds.has(kind)) issues.push(`注册了主表中不存在的类别：${kind}`);
}

const canonicalByMime = new Map<string, string>();
for (const [ext, meta] of entries) {
  if (!meta.canonical) continue;
  const existing = canonicalByMime.get(meta.mime);
  if (existing) {
    issues.push(
      `同一 MIME 有多个代表扩展名：${meta.mime} → ${existing}/${ext}`,
    );
    continue;
  }
  canonicalByMime.set(meta.mime, ext);
}
for (const [ext, meta] of entries) {
  if (!canonicalByMime.has(meta.mime)) {
    issues.push(`MIME 缺少代表扩展名：${meta.mime}（${ext}）`);
  }
}

const canonicalMimes = new Set(canonicalByMime.keys());
for (const [ext, meta] of entries) {
  for (const alias of meta.aliases ?? []) {
    if (canonicalMimes.has(alias)) {
      issues.push(`别名与代表 MIME 冲突：${ext} → ${alias}`);
    }
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(alias)) {
      issues.push(`MIME 别名格式非法：${ext} → ${alias}`);
    }
  }
}

for (const [ext, meta] of entries) {
  for (const mime of [meta.mime, ...(meta.aliases ?? [])]) {
    const resolved = extensionFromContentType(`${mime}; charset=utf-8`);
    const target = EXT_META[resolved];
    if (!target) {
      issues.push(`MIME 反查失败：${mime} → ${resolved || '(空)'}`);
    } else if (target.kind !== meta.kind) {
      issues.push(
        `MIME 反查类别不一致：${mime} → ${resolved}（${target.kind} ≠ ${meta.kind}）`,
      );
    }
  }
}

for (const [ext] of entries) {
  if (!resolvePreview(`probe.${ext}`)) {
    issues.push(`扩展名无法解析预览器：${ext}`);
  }
}

if (getExtension('A.MP3') !== 'mp3') {
  issues.push('扩展名归一化异常：A.MP3');
}
if (getExtension('archive.tar.GZ') !== 'gz') {
  issues.push('扩展名归一化异常：archive.tar.GZ');
}
if (getExtension('no-extension') !== '') {
  issues.push('无扩展名应返回空串：no-extension');
}
if (getFileKind('a.MKV') !== 'video') {
  issues.push('大小写解析异常：a.MKV');
}
// 曾经「图标有、预览无」的格式：必须与预览器注册一致
for (const [name, kind] of [
  ['main.py', 'text'],
  ['main.go', 'text'],
  ['a.tgz', 'archive'],
] as const) {
  if (getFileKind(name) !== kind) {
    issues.push(`类别不一致：${name} 应为 ${kind}`);
  }
  if (!resolvePreview(name)) {
    issues.push(`缺少预览器：${name}`);
  }
}
// 未知扩展名保持 other，不冒充 Excel
if (getFileKind('a.csvx') !== 'other') {
  issues.push('csvx 应归为 other（主表已移除该扩展名）');
}

if (issues.length > 0) {
  console.error(`✗ 格式主表校验失败（${issues.length} 项）：`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log(
  `✓ 格式主表校验通过：${entries.length} 个扩展名 / ${kinds.size} 个类别 / ${canonicalByMime.size} 条代表 MIME`,
);
