import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { desktopDshHome } from '../prompt/promptSettings.js';
import { profilePatchPath } from '../install/winInspectorPlugin.js';
import {
  addDisabledEntry,
  extractInsertBlock,
  hasInsertBlock,
  removeDisabledEntry,
  removeInsertBlock,
} from '../files/profilePatch.js';

/**
 * 插件管理（设置页「插件 → 管理」）：清单与开关由壳 preload 桥
 * `window.dshDesktop.pluginManager` 提供（前端 @deepseek-ai/dsh-plugin-manager 的 host 半边是 no-op）。
 *
 * - entry id 事实源 = 每个已装插件包内 `cordis.patch.yml` 的 `insert` 行 `id`
 *   （不是 BUNDLED_DSH_PLUGINS.rowId——boot-guard/undo-savepoint/doctor 的 rowId 与真实 entry id 不一致）。
 * - 开关 = 读写 profile 层 `cordis.patch.yml`（<dshHome>/profiles/web/cordis.patch.yml）的
 *   `- id: <entryId>` + `disabled: true` 条目，重启 DSH 生效。
 * - 核心组件（@deepseek-ai/dsh-base、@deepseek-ai/dsh-web-app）只读，不可开关。
 */

/** 核心组件（只读：注入 system prompt/agent/tools/webserver 等大量行，无单一可开关 id） */
const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);

export interface PluginRow {
  /** loader entry id（开关定标，写 disabled 条目用） */
  id: string;
  /** 包名（标题） */
  name: string;
  /** 插件描述（读包 package.json 的 description；无则空串，前端显示「（无描述）」） */
  description: string;
  /** 是否启用（读 profile 层 disabled 条目反推） */
  enabled: boolean;
  /** 可开关（core 只读为 false） */
  toggleable: boolean;
  /** 可移除（与 toggleable 同范围：core 不可移除） */
  removable: boolean;
  /** 是否已被移除（profile 层 patch 无该 entry 的 insert 块；移除后重启不再加载） */
  removed: boolean;
}

/** 包在 web profile node_modules 下的目录（scope 包 → @scope/name）。 */
function packageDir(dshHome: string, packageName: string): string {
  return join(dshHome, 'profiles', 'web', 'node_modules', packageName);
}

/** 读包内 cordis.patch.yml 的 insert 行 id（entry id 事实源）；读不到返回 null。 */
function readEntryIdFromPatch(dir: string): string | null {
  const patchPath = join(dir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) return null;
  try {
    const text = readFileSync(patchPath, 'utf8');
    const re = /^\s*-\s*id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/m;
    const m = re.exec(text);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** 从包内 patch 提取 entry id；无则退回包名短名（容忍读不到 patch 的包）。 */
function entryIdFor(dir: string, packageName: string): string {
  return readEntryIdFromPatch(dir) ?? packageName.split('/').pop() ?? packageName;
}

/** 读包 package.json 的 description；无则空串。 */
function readDescription(dir: string): string {
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) return '';
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { description?: unknown };
    return typeof manifest.description === 'string' ? manifest.description : '';
  } catch {
    return '';
  }
}

/** 已装插件包名列表：profile bundles（已挂载）+ dependencies（已装第三方，去重、bundles 优先）。 */
function installedPackages(dshHome: string): string[] {
  const manifestPath = join(dshHome, 'profiles', 'web', 'package.json');
  if (!existsSync(manifestPath)) return [];
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const dsh = (manifest.dsh ?? {}) as Record<string, unknown>;
    const profile = (dsh.profile ?? {}) as Record<string, unknown>;
    const bundles = Array.isArray(profile.bundles) ? (profile.bundles as string[]) : [];
    const deps = Object.keys((manifest.dependencies ?? {}) as Record<string, unknown>);
    return [...new Set([...bundles, ...deps])];
  } catch {
    return [];
  }
}

/** 读 profile 层 cordis.patch.yml，返回已禁用的 entry id 集合。 */
function readDisabledIds(dshHome: string): Set<string> {
  const patchPath = profilePatchPath(dshHome);
  if (!existsSync(patchPath)) return new Set();
  try {
    const text = readFileSync(patchPath, 'utf8');
    const ids = new Set<string>();
    // 按顶层 `- ` 分块，块内同时含 `id: X` 与 `disabled: true` 即视为已禁用
    for (const block of text.split(/\n(?=- )/)) {
      const id = /^\s*-\s*id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/m.exec(block)?.[1];
      if (id && /disabled:\s*true\b/.test(block)) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/** 读 profile 层 cordis.patch.yml，返回已挂载（有 insert 块）的 entry id 集合。 */
function readMountedIds(dshHome: string): Set<string> {
  const patchPath = profilePatchPath(dshHome);
  if (!existsSync(patchPath)) return new Set();
  try {
    const text = readFileSync(patchPath, 'utf8');
    const ids = new Set<string>();
    for (const block of text.split(/\n(?=- )/)) {
      if (!/insert:/.test(block)) continue;
      const id = /^\s*-\s*id:\s*['"]?([A-Za-z0-9._-]+)['"]?\s*$/m.exec(block)?.[1];
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * 列出所有已装插件。
 * @param installDir 壳安装目录（派生 dsh-home）
 */
export function listPlugins(installDir: string): PluginRow[] {
  const dshHome = desktopDshHome(installDir);
  const disabled = readDisabledIds(dshHome);
  const mounted = readMountedIds(dshHome);
  const rows: PluginRow[] = [];
  for (const pkg of installedPackages(dshHome)) {
    const dir = packageDir(dshHome, pkg);
    if (!existsSync(dir)) continue;
    const id = entryIdFor(dir, pkg);
    rows.push({
      id,
      name: pkg,
      description: readDescription(dir),
      // enabled 只看 disabled 条目（前端 client.js 自行组合 enabled && !removed）；
      // removed = profile 层无该 entry 的 insert 块（移除后不再加载）
      enabled: !disabled.has(id),
      toggleable: !CORE_BUNDLES.has(pkg),
      removable: !CORE_BUNDLES.has(pkg),
      removed: !mounted.has(id),
    });
  }
  // 可开关在前、只读在后，同组按名排序
  return rows.sort(
    (a, b) => (a.toggleable === b.toggleable ? 0 : a.toggleable ? -1 : 1) || a.name.localeCompare(b.name),
  );
}

/**
 * 开关插件：写/删 profile 层 cordis.patch.yml 的 `- id: X` + `disabled: true` 条目。
 * 核心只读插件拒绝。返回 {ok:true} 或 {ok:false,error}（前端 res.ok / res.error）。
 */
export function setPluginEnabled(
  installDir: string,
  id: string,
  enabled: boolean,
): { ok: true } | { ok: false; error: string } {
  const dshHome = desktopDshHome(installDir);
  const row = listPlugins(installDir).find((r) => r.id === id);
  if (!row) return { ok: false, error: `未知插件：${id}` };
  if (!row.toggleable) return { ok: false, error: `${row.name} 是核心组件，不可关闭` };

  const patchPath = profilePatchPath(dshHome);
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const next = enabled ? removeDisabledEntry(existing, id) : addDisabledEntry(existing, id);
  if (next !== existing) writeFileSync(patchPath, next, 'utf8');
  return { ok: true };
}

/**
 * 移除/恢复插件（卸载语义，@deepseek-ai/dsh-plugin-manager 的 setRemoved 桥）：
 * 移除 = 从 profile 层 patch 删该 entry 的 insert 块 + 标 disabled（双保险），重启后不再加载；
 * 恢复 = 从包内 patch 读回 insert 块追加 + 清 disabled。核心只读插件拒绝。
 */
export function setPluginRemoved(
  installDir: string,
  id: string,
  removed: boolean,
): { ok: true } | { ok: false; error: string } {
  const dshHome = desktopDshHome(installDir);
  const row = listPlugins(installDir).find((r) => r.id === id);
  if (!row) return { ok: false, error: `未知插件：${id}` };
  if (!row.removable) return { ok: false, error: `${row.name} 是核心组件，不可移除` };

  const patchPath = profilePatchPath(dshHome);
  const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
  const next = removed
    ? removeInsertBlock(existing, id)
    : restoreInsertBlock(existing, id, packageDir(dshHome, row.name));
  if (next !== existing) writeFileSync(patchPath, next, 'utf8');
  return { ok: true };
}

/** 恢复：从包内 patch 读回 insert 块追加到 profile 层 patch；同时删 disabled 条目。 */
function restoreInsertBlock(existing: string, id: string, packageDir: string): string {
  const withoutDisabled = removeDisabledEntry(existing, id);
  if (hasInsertBlock(withoutDisabled, id)) return withoutDisabled;
  const block = extractInsertBlock(readFileSync(join(packageDir, 'cordis.patch.yml'), 'utf8'), id);
  if (!block) return withoutDisabled; // 包内无 patch（读不到）→ 只清 disabled，不追加
  const trimmed = withoutDisabled.trimEnd();
  return `${trimmed}\n${block}\n`;
}
