import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Dirent, Stats } from 'node:fs';
import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
} from 'node:path';
import { homedir } from 'node:os';
import { ResourceRootsService } from '#/infra/resource-roots/resource-roots.service.js';
import {
  CreateResourceRootDto,
  UpdateResourceRootDto,
} from './dto/resource-root.dto.js';
import { ROOT_BROWSE_MAX_ENTRIES } from '@vakao/shared';
import type {
  BrowseBound,
  BrowseBoundSource,
  BrowseDirectoriesResult,
  BrowseShortcut,
  ResourceRoot,
} from '@vakao/shared';

/** child 是否位于 parent 之内（按路径分段判断，避免 `/foo` 误判 `/foobar`） */
function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 边界展示顺序：根目录父级 → 白名单 → 主目录（越靠前越适合作为默认起点） */
const BROWSE_BOUND_PRIORITY: Record<BrowseBoundSource, number> = {
  'root-parent': 0,
  whitelist: 1,
  home: 2,
};

/**
 * 资源根目录管理服务
 * 负责根目录配置的增删改查、物理目录创建与系统目录浏览
 */
@Injectable()
export class RootsService {
  constructor(private readonly resourceRoots: ResourceRootsService) {}

  /** 相对路径按进程工作目录解析，绝对路径原样保留 */
  private resolvePath(path: string): string {
    return isAbsolute(path) ? path : resolve(process.cwd(), path);
  }

  private assertRootId(id: string) {
    if (id === 'roots') {
      throw new BadRequestException('非法的根目录 ID');
    }
  }

  /** 递归统计真实文件数量（跳过隐藏项与空目录） */
  private async countFiles(dir: string): Promise<number> {
    const entries = await readdir(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        count += await this.countFiles(resolve(dir, entry.name));
      } else if (entry.isFile()) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 校验并创建目录：
   * - 路径不存在 → 递归创建
   * - 已存在但不是目录 → 400
   * - 权限不足 → 400 并给出可读原因（不伪造成功）
   */
  private async ensureDirectory(path: string) {
    const fullPath = this.resolvePath(path);
    try {
      const info = await stat(fullPath);
      if (!info.isDirectory()) {
        throw new BadRequestException(`路径已存在且不是目录：${path}`);
      }
      return fullPath;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new BadRequestException(
          `无法访问路径 ${path}（${code ?? '未知错误'}），请检查权限或路径是否合法`,
        );
      }
    }

    try {
      await mkdir(fullPath, { recursive: true });
      return fullPath;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new BadRequestException(
        code === 'EACCES' || code === 'EPERM'
          ? `没有写入权限，无法创建目录：${path}`
          : `创建目录失败：${path}（${code ?? '未知错误'}）`,
      );
    }
  }

  private assertPathUnique(path: string, excludeId?: string) {
    const target = this.resolvePath(path);
    const duplicated = this.resourceRoots
      .getRoots()
      .find(
        (root) =>
          root.id !== excludeId && this.resolvePath(root.path) === target,
      );
    if (duplicated) {
      throw new ConflictException(
        `根路径已被根目录「${duplicated.name}」(${duplicated.id}) 使用`,
      );
    }
  }

  getRoots() {
    return this.resourceRoots.getRoots();
  }

  async addRoot(body: CreateResourceRootDto) {
    this.assertRootId(body.id);
    const id = body.id.trim();
    const name = body.name.trim();
    const path = body.path.trim();
    if (!id || !name || !path) {
      throw new BadRequestException('根目录 ID、名称、路径均不能为空');
    }
    if (this.resourceRoots.getRoot(id)) {
      throw new ConflictException(`根目录 ID 已存在：${id}`);
    }
    this.assertPathUnique(path);
    // 手输路径同样受边界约束：不允许在允许范围之外新建根目录
    await this.assertPathAllowed(path);

    // 先落盘再写配置，避免配置里出现不可用的根目录
    await this.ensureDirectory(path);

    const root: ResourceRoot = { id, name, path };
    await this.resourceRoots.addRoot(root);
    return this.resourceRoots.getRoots();
  }

  async removeRoot(id: string) {
    this.assertRootId(id);
    const root = this.resourceRoots.getRoot(id);
    if (!root) {
      throw new NotFoundException(`根目录不存在：${id}`);
    }
    if (this.resourceRoots.getRoots().length <= 1) {
      throw new ConflictException('至少需要保留一个根目录，无法删除最后一个');
    }

    const fullPath = this.resolvePath(root.path);
    let fileCount = 0;
    try {
      // 只统计真实文件（递归进入分类目录），忽略 .DS_Store 等隐藏项：
      // 空分类目录本身不构成数据，否则「删除文件后仍无法删除根目录」会变成死路
      fileCount = await this.countFiles(fullPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw new BadRequestException(
          `无法读取根目录 ${root.path}（${code ?? '未知错误'}）`,
        );
      }
    }

    if (fileCount > 0) {
      throw new ConflictException(
        `根目录下仍有 ${fileCount} 个文件（含分类目录内），请先清空后再删除`,
      );
    }

    await this.resourceRoots.removeRoot(id);
    return { success: true };
  }

  async updateRoot(id: string, body: UpdateResourceRootDto) {
    this.assertRootId(id);
    const root = this.resourceRoots.getRoot(id);
    if (!root) {
      throw new NotFoundException(`根目录不存在：${id}`);
    }

    const updates: Partial<Omit<ResourceRoot, 'id'>> = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('根目录名称不能为空');
      updates.name = name;
    }
    if (body.path !== undefined) {
      const path = body.path.trim();
      if (!path) throw new BadRequestException('根目录路径不能为空');
      this.assertPathUnique(path, id);

      const oldPath = this.resolvePath(root.path);
      const newPath = this.resolvePath(path);
      if (newPath !== oldPath) {
        await this.assertPathAllowed(path);
        // 旧目录已有内容时不允许改路径：避免配置切换后旧文件“凭空消失”
        try {
          const entries = await readdir(oldPath);
          if (entries.filter((entry) => !entry.startsWith('.')).length > 0) {
            throw new ConflictException(
              '该根目录下已有文件/分类，不支持修改物理路径；请新建一个根目录',
            );
          }
        } catch (error) {
          if (error instanceof ConflictException) throw error;
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            throw new BadRequestException(
              `无法读取旧根目录（${code ?? '未知错误'}）`,
            );
          }
        }
        await this.ensureDirectory(path);
      }
      updates.path = path;
    }

    await this.resourceRoots.updateRoot(id, updates);
    return this.resourceRoots.getRoots();
  }

  /**
   * 允许浏览与创建根目录的边界（真实路径 + 来源）
   *
   * - 每个已配置根目录的父级（便于把新根目录挂在既有存储目录旁边）
   * - 当前运行用户的主目录
   * - `ROOT_BROWSE_WHITELIST` 环境变量（逗号分隔的绝对路径，需自行确保可信）
   *
   * 用 realpath 归一，符号链接无法借此逃逸到边界之外；
   * 排序保证「根目录父级 → 白名单 → 主目录」，前端据此挑选默认起点。
   */
  async getBrowseBounds(): Promise<BrowseBound[]> {
    const candidates = new Map<
      string,
      { label: string; source: BrowseBoundSource }
    >();
    const add = (path: string, label: string, source: BrowseBoundSource) => {
      const key = normalize(path);
      if (!candidates.has(key)) candidates.set(key, { label, source });
    };

    add(homedir(), '用户主目录', 'home');
    for (const root of this.resourceRoots.getRoots()) {
      add(dirname(this.resolvePath(root.path)), '根目录父级', 'root-parent');
    }
    for (const item of (process.env.ROOT_BROWSE_WHITELIST ?? '').split(',')) {
      const trimmed = item.trim();
      if (trimmed && isAbsolute(trimmed)) add(trimmed, '白名单', 'whitelist');
    }

    const bounds: BrowseBound[] = [];
    const seen = new Set<string>();
    for (const [candidate, meta] of candidates) {
      try {
        const real = await realpath(candidate);
        if (seen.has(real)) continue;
        seen.add(real);
        bounds.push({ path: real, ...meta });
      } catch {
        // 边界目录本身不存在时跳过，不影响其它边界
      }
    }
    return bounds.sort(
      (a, b) =>
        BROWSE_BOUND_PRIORITY[a.source] - BROWSE_BOUND_PRIORITY[b.source] ||
        a.path.localeCompare(b.path),
    );
  }

  private async allowedBrowseRealPaths(): Promise<string[]> {
    return (await this.getBrowseBounds()).map((bound) => bound.path);
  }

  /**
   * 已配置根目录的快捷入口（真实路径 + 显示名称）
   *
   * 与边界不同：根目录本身通常落在某个父级边界内，
   * 这里单独返回是为了让目录弹框能一键跳到具体根目录。
   */
  async getRootShortcuts(): Promise<BrowseShortcut[]> {
    const shortcuts: BrowseShortcut[] = [];
    for (const root of this.resourceRoots.getRoots()) {
      try {
        shortcuts.push({
          path: await realpath(this.resolvePath(root.path)),
          label: root.name,
          rootId: root.id,
        });
      } catch {
        // 物理目录缺失时跳过，配置本身仍保留
      }
    }
    return shortcuts;
  }

  /**
   * 校验目标路径是否落在允许边界内（新建根目录 / 修改根目录路径时使用）
   *
   * 目标目录可能尚不存在，因此对最近的已存在祖先做 realpath，
   * 再拼回剩余路径段，避免符号链接借道逃逸到边界之外。
   */
  private async assertPathAllowed(path: string): Promise<void> {
    const target = this.resolvePath(path);
    const bounds = await this.getBrowseBounds();
    if (bounds.length === 0) {
      throw new ForbiddenException('没有可用的目录边界，无法创建根目录');
    }

    let probe = target;
    let realBase = '';
    for (;;) {
      try {
        realBase = await realpath(probe);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          throw new BadRequestException(
            `无法解析路径 ${path}（${code ?? '未知错误'}）`,
          );
        }
        const parent = dirname(probe);
        if (parent === probe) {
          throw new BadRequestException(`无法解析路径：${path}`);
        }
        probe = parent;
      }
    }

    const candidate =
      probe === target ? realBase : join(realBase, relative(probe, target));
    if (!bounds.some((bound) => isWithin(candidate, bound.path))) {
      throw new ForbiddenException(
        `路径不在允许范围内：${path}。允许的前缀：${bounds
          .map((bound) => bound.path)
          .join('、')}`,
      );
    }
  }

  /** 把 fs 错误翻译为可读的 4xx，避免无权限/不存在被当成 500 */
  private browseError(path: string, error: unknown): Error {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') return new NotFoundException(`目录不存在：${path}`);
    if (code === 'EACCES' || code === 'EPERM') {
      return new BadRequestException(`没有权限读取目录：${path}`);
    }
    if (code === 'ENOTDIR') {
      return new BadRequestException(`目标不是目录：${path}`);
    }
    return new BadRequestException(
      `无法读取目录 ${path}（${code ?? '未知错误'}）`,
    );
  }

  /**
   * 浏览服务器目录（仅目录、不返回文件）
   *
   * 安全边界：
   * 1. 只接受绝对路径，显式拒绝 `..` 段与相对路径；
   * 2. realpath 解析后必须落在允许边界内，符号链接无法逃逸；
   * 3. 只枚举目录，符号链接目录不列出、不可进入；
   * 4. 单次最多返回 ROOT_BROWSE_MAX_ENTRIES 项，超出标记 truncated；
   * 5. ENOENT → 404，EACCES/EPERM → 400 可读原因，越界 → 403。
   */
  async browseDirectories(input?: string): Promise<BrowseDirectoriesResult> {
    const raw = (input ?? '').trim();
    if (raw && raw.split(/[\\/]/).includes('..')) {
      throw new BadRequestException('目录路径不允许包含 `..`');
    }

    // 相对路径按进程工作目录解析（与根目录 path 的解析规则一致），
    // 因此编辑形如 "storage" 的相对根目录时也能直接定位；
    // 越界仍由下方 realpath + 边界判断兜底，相对路径不会扩大可访问范围
    const target = raw ? resolve(raw) : homedir();
    const allowed = await this.allowedBrowseRealPaths();

    let real: string;
    try {
      real = await realpath(target);
    } catch (error) {
      throw this.browseError(target, error);
    }

    const boundary = allowed.find((prefix) => isWithin(real, prefix));
    if (!boundary) {
      throw new ForbiddenException(
        `不允许浏览该目录：${real}。允许的前缀：${allowed.join('、')}`,
      );
    }

    let info: Stats;
    let dirents: Dirent[];
    try {
      info = await stat(real);
    } catch (error) {
      throw this.browseError(real, error);
    }
    if (!info.isDirectory()) {
      throw new BadRequestException(`目标不是目录：${real}`);
    }
    try {
      dirents = await readdir(real, { withFileTypes: true });
    } catch (error) {
      throw this.browseError(real, error);
    }

    const dirs = dirents
      .filter((d) => d.isDirectory() && !d.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      path: real,
      parent: real === boundary ? null : dirname(real),
      entries: dirs
        .slice(0, ROOT_BROWSE_MAX_ENTRIES)
        .map((d) => ({ name: d.name, path: join(real, d.name) })),
      truncated: dirs.length > ROOT_BROWSE_MAX_ENTRIES,
      total: dirs.length,
    };
  }
}
