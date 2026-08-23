import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface BundledPluginRow { rowId: string; directory: string; packageName: string }
/**
 * 内置 DSH 插件清单。自定义背景插件（plugin-background）已暂停开发移除内置，
 * 成果与设计资产（派生层 CSS、token 基线）保存在工作区 plugin/换色/plugin-background/；
 * 恢复时把行 { rowId: 'desktop-background', directory: 'plugin-background',
 * packageName: '@dsh-desktop/plugin-background' } 加回本清单，并把插件目录放回 plugins/。
 */
export const BUNDLED_DSH_PLUGINS: readonly BundledPluginRow[] = [
  { rowId: 'desktop-global-prompt', directory: 'plugin-global-prompt', packageName: '@dsh-desktop/plugin-global-prompt' },
  // 整合包：内置插件市场（第三方，无 scope 包按真实位置布局；npm 依赖 js-yaml/undici 需存在于 DSH runtime 顶层 node_modules）
  { rowId: 'dsh-market', directory: 'dshmarket', packageName: 'dshmarket' },
  // 整合包自救层（第三方，全部零 npm 依赖；peer 仅 @deepseek-ai/cordis，vendor 已提供）
  { rowId: 'dsh-boot-guard', directory: 'dsh-boot-guard', packageName: 'dsh-boot-guard' },
  { rowId: 'dsh-undo-savepoint', directory: 'dsh-undo-savepoint', packageName: 'dsh-undo-savepoint' },
  { rowId: 'moonquake-dsh-doctor', directory: '@moonquake2004/dsh-doctor', packageName: '@moonquake2004/dsh-doctor' },
];



/**
 * rc.8 web profile core bundles (mirrors the shipped PROFILE_TEMPLATES.web).
 * Kept here so the shell can seed a first-run manifest with a fully functional
 * profile instead of waiting for `dsh` to initialize it.
 */
const WEB_CORE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const;

/** The empty user patch layer DSH expects at `profiles/<name>/cordis.patch.yml`. */
const PROFILE_PATCH_TEMPLATE = ['# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
  ''].join('\n');

export const bundledPackageNames = (): string[] => BUNDLED_DSH_PLUGINS.map((p) => p.packageName);

/**
 * 把引擎隔离台账（isolatedPluginIds，会话内存级）映射成本会话应跳过同步的内置插件包名。
 * 只收集内置清单内的条目（按 rowId 或 packageName 匹配）；第三方插件不在清单、
 * ensure 不处理它们，隔离靠物理移除即可，无需在此列出。
 * 隔离不落盘：新进程重建台账 → 下次启动自动重新尝试，插件修复后即可恢复。
 */
export function isolatedBundledNames(isolatedIds: readonly string[]): string[] {
  const ids = new Set(isolatedIds);
  return BUNDLED_DSH_PLUGINS
    .filter((p) => ids.has(p.rowId) || ids.has(p.packageName))
    .map((p) => p.packageName);
}

/**
 * 包在 node_modules 下的真实目录：带 scope（@dsh-desktop/x）→ node_modules/@dsh-desktop/x；
 * 无 scope（如 dshmarket）→ node_modules/dshmarket。第三方无 scope 包必须按真实位置布局，
 * 否则 loader 按 `name: 'dshmarket'` 解析不到 @dsh-desktop/ 下错放的副本。
 */
export function packageNodeModulesDir(root: string, packageName: string): string {
  const slash = packageName.indexOf('/');
  return slash === -1
    ? join(root, 'node_modules', packageName)
    : join(root, 'node_modules', packageName.slice(0, slash), packageName.slice(slash + 1));
}

/**
 * rc.8 mechanism: register bundled plugins as profile bundles by appending their
 * package names to `dsh.profile.bundles` in the profile manifest, idempotently.
 * Preserves existing bundles and every other manifest field. Returns a new
 * manifest object; never mutates the input. Returns the same reference when
 * nothing changed.
 */
export function withBundledPluginBundles(manifest: Record<string, unknown>): Record<string, unknown> {
  const dsh = (manifest.dsh ?? {}) as Record<string, unknown>;
  const profile = (dsh.profile ?? {}) as Record<string, unknown>;
  const bundles = Array.isArray(profile.bundles) ? [...(profile.bundles as string[])] : [];
  let changed = false;
  for (const name of bundledPackageNames()) {
    if (!bundles.includes(name)) { bundles.push(name); changed = true; }
  }
  if (!changed) return manifest;
  return {
    ...manifest,
    dsh: {
      ...dsh,
      profile: { ...profile, bundles },
    },
  };
}

/** rc.6-era alias kept for compatibility with any external importer. */
export const withBundledPluginEntries = withBundledPluginBundles;

function readProfileManifest(dir: string): Record<string, unknown> | null {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

/**
 * rc.8 layout: pnpm stores @deepseek-ai/* peer deps under node_modules/.pnpm
 * (e.g. `@deepseek-ai+schemastery@3.18.1` or `@deepseek-ai+dsh-home-paths_<hash>`)
 * and does not hoist them to the top-level @deepseek-ai/ scope. Bundled plugins
 * live at node_modules/@dsh-desktop/* and resolve their `@deepseek-ai/*` imports by
 * walking up to the DSH runtime's top-level @deepseek-ai/, so those peers must be
 * exposed there. This links each plugin-imported @deepseek-ai peer into the top
 * level if it exists in the store and is not already exposed.
 */
function linkPluginPeerDeps(dshRuntimeRoot: string, pluginDirs: string[]): void {
  const top = join(dshRuntimeRoot, 'node_modules', '@deepseek-ai');
  const store = join(dshRuntimeRoot, 'node_modules', '.pnpm');
  if (!existsSync(top) || !existsSync(store)) return;
  const wanted = new Set<string>();
  for (const dir of pluginDirs) {
    const indexJs = join(dir, 'index.js');
    if (!existsSync(indexJs)) continue;
    const source = readFileSync(indexJs, 'utf8');
    const re = /from ['"]@deepseek-ai\/([A-Za-z0-9._-]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) wanted.add(m[1]);
  }
  for (const name of wanted) {
    const dst = join(top, name);
    if (existsSync(dst) || lstatSync(dst, { throwIfNoEntry: false })) continue;
    const prefix = '@deepseek-ai+' + name;
    const match = existsSync(store) ? readdirSyncSafe(store).find((d) => d.startsWith(prefix + '@') || d.startsWith(prefix + '_')) : undefined;
    if (match === undefined) continue;
    const src = join(store, match, 'node_modules', '@deepseek-ai', name);
    if (!existsSync(src)) continue;
    try { symlinkSync(src, dst, process.platform === 'win32' ? 'junction' : 'dir'); } catch { /* best-effort */ }
  }
}

function readdirSyncSafe(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}


/**
 * Copy bundled plugin packages into the DSH runtime's node_modules (so they
 * resolve from the DSH installation) and junction them into the web profile's
 * node_modules, then register them in the profile manifest's `dsh.profile.bundles`
 * (rc.8 bundle mechanism). Ensures the profile manifest and its empty user patch
 * layer exist so DSH boots without waiting on `dsh plugin` init.
 */
export function ensureBundledDshPlugins(options: {
  dshHome: string;
  dshRuntimeRoot: string;
  sourceRoot: string;
  /** 已隔离（自救处置禁用）的插件包名：不同步装载，保留源码与配置待用户恢复 */
  quarantined?: readonly string[];
}): boolean {
  let changed = false;
  const profileRoot = join(options.dshHome, 'profiles', 'web');
  const quarantined = new Set(options.quarantined ?? []);
  const active = BUNDLED_DSH_PLUGINS.filter((p) => !quarantined.has(p.packageName));
  for (const p of active) {
    const source = join(options.sourceRoot, p.directory);
    if (!existsSync(source)) continue;
    const target = packageNodeModulesDir(options.dshRuntimeRoot, p.packageName);
    const profilePackage = packageNodeModulesDir(profileRoot, p.packageName);
    mkdirSync(dirname(target), { recursive: true });
    mkdirSync(dirname(profilePackage), { recursive: true });
    cpSync(source, target, { recursive: true, force: true });
    // 断链自愈：无论占位是断 junction、旧链接还是旧目录，一律先清掉再重建——
    // 2026-08-22 实测：目录挪动后 junction 指向旧绝对路径，lstat 报 ENOENT（像不存在），
    // 直接 symlinkSync 会 EEXIST，插件装配失败 → DSH 启动即崩。unlink 对链接（含断链）有效，
    // 真目录（历史布局残留）走 rmSync；两者都失败即目标本就不存在，直接链接。
    try {
      unlinkSync(profilePackage);
    } catch {
      try {
        rmSync(profilePackage, { recursive: true, force: true });
      } catch { /* 无占位，直接重建 */ }
    }
    symlinkSync(target, profilePackage, process.platform === 'win32' ? 'junction' : 'dir');
    changed = true;
  }
  // rc.8 layout: expose plugin-imported @deepseek-ai peers (schemastery, dsh-settings,
  // dsh-home-paths, ...) at the DSH runtime's top-level @deepseek-ai so bundled
  // plugins resolve them (pnpm does not hoist them there by default).
  linkPluginPeerDeps(options.dshRuntimeRoot, BUNDLED_DSH_PLUGINS.map((p) => join(options.sourceRoot, p.directory)));

  // rc.8: register plugins as profile bundles instead of injecting `- insert`
  // rows into cordis.patch.yml (the rc.6 mechanism DSH 0.1.0-rc.8 rejects as a
  // duplicate loader entry). Ensure the profile manifest and empty patch layer
  // exist so a first-run profile is fully functional.
  const profileDir = join(options.dshHome, 'profiles', 'web');
  mkdirSync(profileDir, { recursive: true });
  const manifestPath = join(profileDir, 'package.json');
  const patchPath = join(profileDir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) { writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE, 'utf8'); changed = true; }
  // Retire @dsh-desktop/* bundles that are no longer in BUNDLED_DSH_PLUGINS
  // (e.g. after the global-prompt plugin was unbundled for standalone release):
  // drop them from the profile manifest, unlink the profile junction (link only,
  // never recursive — see the junction note above), and remove the copied package
  // from the DSH runtime's node_modules.
  const retiredManifest = readProfileManifest(profileDir);
  if (retiredManifest) {
    const profileObj = (retiredManifest.dsh ?? {}) as Record<string, unknown>;
    const profile = (profileObj.profile ?? {}) as Record<string, unknown>;
    const bundles = Array.isArray(profile.bundles) ? (profile.bundles as string[]) : [];
    const bundled = new Set(active.map((p) => p.packageName));
    // 只处置壳管辖的条目：非官方 bundle、不在当前有效清单（含被隔离的）、
    // 且不是 profile dependencies（用户经 dsh plugin / 市场安装的第三方归用户管）。
    const deps = new Set(Object.keys((retiredManifest.dependencies ?? {}) as Record<string, unknown>));
    const retired = bundles.filter((n) => !bundled.has(n) && !n.startsWith('@deepseek-ai/') && !deps.has(n));
    if (retired.length > 0) {
      const nextManifest = {
        ...retiredManifest,
        dsh: { ...profileObj, profile: { ...profile, bundles: bundles.filter((n) => !retired.includes(n)) } },
      };
      writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2) + '\n', 'utf8');
      for (const name of retired) {
        const profilePackage = packageNodeModulesDir(profileRoot, name);
        const prior = lstatSync(profilePackage, { throwIfNoEntry: false });
        if (prior?.isSymbolicLink()) unlinkSync(profilePackage);
        const target = packageNodeModulesDir(options.dshRuntimeRoot, name);
        if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      }
      changed = true;
    }
  }
  const existingManifest = readProfileManifest(profileDir);
  const manifest = existingManifest ?? {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: [...WEB_CORE_BUNDLES] } },
  };
  // 只按 active 集合注册（隔离的插件不得回流 bundles）；withBundledPluginBundles
  // 基于完整清单，会把隔离包加回来，故此处内联等价逻辑。
  const manifestObj = manifest as Record<string, unknown>;
  const manifestDsh = (manifestObj.dsh ?? {}) as Record<string, unknown>;
  const manifestProfile = (manifestDsh.profile ?? {}) as Record<string, unknown>;
  const currentBundles = Array.isArray(manifestProfile.bundles) ? [...(manifestProfile.bundles as string[])] : [];
  let bundlesChanged = false;
  for (const p of active) {
    if (!currentBundles.includes(p.packageName)) { currentBundles.push(p.packageName); bundlesChanged = true; }
  }
  const next = bundlesChanged
    ? { ...manifestObj, dsh: { ...manifestDsh, profile: { ...manifestProfile, bundles: currentBundles } } }
    : manifest;
  if (existingManifest === null || bundlesChanged) {
    writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    changed = true;
  }
  return changed;
}

