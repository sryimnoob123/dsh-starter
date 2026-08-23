import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addInsertEntry } from '../files/profilePatch.js';

/**
 * 捆绑第三方 bug-fix 插件 dsh-win-terminal-inspector（[bugfix] DSH win32 持久终端）：
 * 把插件装进壳自己的 web profile（<DSH_HOME>/profiles/web/plugins/<name>/），并在
 * <DSH_HOME>/profiles/web/cordis.patch.yml 追加 insert 条目。
 *
 * 稳定边界：
 * - 只写 web profile 的 cordis.patch.yml（与 home 根的 $DSH_HOME/cordis.patch.yml 是两个文件，
 *   home 根那个归提示词/persona 管，这里绝不碰）；
 * - 追加合并（幂等），绝不整体覆盖用户手动加的其他条目；
 * - 非 win32 直接 no-op（插件自身也只在 win32 生效）。
 */

/** 插件目录名（与 cordis.patch.yml 里的 name 相对路径一致） */
export const WIN_INSPECTOR_DIR = 'dsh-win-terminal-inspector';
/** patch 条目 id（loader 按 id 去重，防重复装配） */
export const WIN_INSPECTOR_ROW_ID = 'win-terminal-inspector';
/** 需要从壳捆绑包拷进 profile 的运行时文件（相对插件目录） */
export const WIN_INSPECTOR_FILES = ['index.js', 'package.json', 'lib/inspector.js'] as const;

/** web profile 插件目录（DSH 官方插件挂载点） */
export function profilePluginDir(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'plugins', WIN_INSPECTOR_DIR);
}

/** web profile 的 cordis.patch.yml 路径 */
export function profilePatchPath(dshHome: string): string {
  return join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
}

/**
 * 把检查器 insert 条目幂等追加进 profile patch 内容（文本操作收敛在 files/profilePatch.ts）。
 * - 已存在该 id → 原样返回（不改用户手动内容）；
 * - 内容以空数组 [] 结尾（DSH 首次生成的默认态）→ 把 [] 替换成条目；
 * - 其他情况 → 末尾追加一个新条目。
 */
export function withInspectorPatchEntry(existing: string): string {
  return addInsertEntry(existing, WIN_INSPECTOR_ROW_ID, `./plugins/${WIN_INSPECTOR_DIR}/index.js`);
}

/**
 * 把捆绑的检查器插件装进 web profile。幂等；非 win32 no-op。
 * @returns 是否发生了 patch 内容变更（true = 首次写入/补了条目）。
 */
export function ensureWinTerminalInspector(options: {
  dshHome: string;
  sourceDir: string;
  platform?: NodeJS.Platform;
}): boolean {
  if ((options.platform ?? process.platform) !== 'win32') return false;
  const pluginDir = profilePluginDir(options.dshHome);
  mkdirSync(join(pluginDir, 'lib'), { recursive: true });
  for (const rel of WIN_INSPECTOR_FILES) {
    const src = join(options.sourceDir, rel);
    const dst = join(pluginDir, rel);
    if (existsSync(src)) copyFileSync(src, dst);
  }
  const patchPath = profilePatchPath(options.dshHome);
  mkdirSync(dirname(patchPath), { recursive: true });
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const next = withInspectorPatchEntry(existing);
  if (next === existing) return false;
  writeFileSync(patchPath, next, 'utf8');
  return true;
}
