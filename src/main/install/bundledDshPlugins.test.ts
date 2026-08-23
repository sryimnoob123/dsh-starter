import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLED_DSH_PLUGINS, bundledPackageNames, ensureBundledDshPlugins, isolatedBundledNames, packageNodeModulesDir, withBundledPluginBundles } from './bundledDshPlugins.js';

const dirs: string[] = [];
const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'dsh-plugins-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('withBundledPluginBundles', () => {
  it('appends every bundled package name without touching user bundles or other fields', () => {
    const manifest = { name: 'dsh-profile-web', private: true, dependencies: { x: '1' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'user-plugin'] } } };
    const next = withBundledPluginBundles(manifest as Record<string, unknown>);
    expect(next).not.toBe(manifest);
    expect(next.dependencies).toEqual({ x: '1' });
    const b = (next.dsh as any).profile.bundles as string[];
    for (const p of BUNDLED_DSH_PLUGINS) expect(b).toContain(p.packageName);
    expect(b).toContain('user-plugin');
    expect(b).toContain('@deepseek-ai/dsh-base');
    expect(b.some((n) => n.startsWith('@dsh-desktop/plugin-background'))).toBe(false);
  });

  it('is idempotent: a second call returns the same reference', () => {
    const manifest = { dsh: { profile: { bundles: bundledPackageNames() } } };
    expect(withBundledPluginBundles(manifest as Record<string, unknown>)).toBe(manifest);
  });

  it('creates a bundles array when the profile has none', () => {
    const manifest = { name: 'x' };
    const next = withBundledPluginBundles(manifest as Record<string, unknown>);
    const b = (next.dsh as any).profile.bundles as string[];
    expect(b.length).toBe(BUNDLED_DSH_PLUGINS.length);
  });
});

describe('ensureBundledDshPlugins', () => {
  it('copies packages into the active DSH node_modules and registers them as profile bundles', () => {
    const dshHome = fresh(); const dshRuntimeRoot = fresh(); const sourceRoot = fresh();
    for (const p of BUNDLED_DSH_PLUGINS) {
      const src = join(sourceRoot, p.directory); mkdirSync(src, { recursive: true });
      const files: Array<[string, string]> = [
        ['index.js', `new-${p.rowId}`], ['client.js', 'client'],
        ['package.json', JSON.stringify({ name: p.packageName })],
        ['README.md', '# readme'], ['LICENSE', 'MIT'],
        ['cordis.patch.yml', '- insert:\n    - id: ' + p.rowId],
      ];
      for (const [name, body] of files) writeFileSync(join(src, name), body, 'utf8');
    }
    const changed = ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot });
    expect(changed).toBe(true);
    const manifest = JSON.parse(readFileSync(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8'));
    const bundles = manifest.dsh.profile.bundles as string[];
    expect(bundles).toContain('@deepseek-ai/dsh-base');
    for (const p of BUNDLED_DSH_PLUGINS) expect(bundles).toContain(p.packageName);
    expect(existsSync(join(dshHome, 'profiles', 'web', 'cordis.patch.yml'))).toBe(true);
    for (const p of BUNDLED_DSH_PLUGINS) {
      const dst = packageNodeModulesDir(dshRuntimeRoot, p.packageName);
      const profilePackage = packageNodeModulesDir(join(dshHome, 'profiles', 'web'), p.packageName);
      expect(realpathSync(profilePackage)).toBe(realpathSync(dst));
      expect(readFileSync(join(dst, 'index.js'), 'utf8')).toBe(`new-${p.rowId}`);
    }
  });

  it('is idempotent on a second run', () => {
    const dshHome = fresh(); const dshRuntimeRoot = fresh(); const sourceRoot = fresh();
    for (const p of BUNDLED_DSH_PLUGINS) {
      const src = join(sourceRoot, p.directory); mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'index.js'), `new-${p.rowId}`, 'utf8'); writeFileSync(join(src, 'client.js'), 'c', 'utf8'); writeFileSync(join(src, 'package.json'), '{}', 'utf8');
    }
    ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot });
    const first = JSON.stringify(JSON.parse(readFileSync(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')));
    ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot });
    const second = JSON.stringify(JSON.parse(readFileSync(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')));
    expect(second).toBe(first);
  });

  it('retires @dsh-desktop bundles no longer in the bundled list', () => {
    const dshHome = fresh(); const dshRuntimeRoot = fresh(); const sourceRoot = fresh();
    // live 源：仍在清单里的 global-prompt
    for (const p of BUNDLED_DSH_PLUGINS) {
      const src = join(sourceRoot, p.directory); mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'index.js'), 'live', 'utf8'); writeFileSync(join(src, 'client.js'), 'c', 'utf8'); writeFileSync(join(src, 'package.json'), '{}', 'utf8');
    }
    // 模拟移除前的状态：plugin-background 已复制进 runtime、junction 进 profile、列入 manifest
    const retired = { rowId: 'desktop-background', directory: 'plugin-background', packageName: '@dsh-desktop/plugin-background' };
    const retiredRuntime = join(dshRuntimeRoot, 'node_modules', '@dsh-desktop', 'plugin-background');
    mkdirSync(retiredRuntime, { recursive: true });
    writeFileSync(join(retiredRuntime, 'index.js'), 'retired', 'utf8');
    const profileDir = join(dshHome, 'profiles', 'web');
    mkdirSync(join(profileDir, 'node_modules', '@dsh-desktop'), { recursive: true });
    const profilePackage = join(profileDir, 'node_modules', '@dsh-desktop', 'plugin-background');
    symlinkSync(retiredRuntime, profilePackage, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web', private: true, dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', retired.packageName] } },
    }), 'utf8');

    const changed = ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot });
    expect(changed).toBe(true);
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
    const bundles = manifest.dsh.profile.bundles as string[];
    expect(bundles).not.toContain(retired.packageName);
    for (const p of BUNDLED_DSH_PLUGINS) expect(bundles).toContain(p.packageName);
    expect(existsSync(profilePackage)).toBe(false);
    expect(existsSync(retiredRuntime)).toBe(false);
    // live plugin still present
    const liveName = BUNDLED_DSH_PLUGINS[0]!.packageName.split('/')[1]!;
    expect(existsSync(join(dshRuntimeRoot, 'node_modules', '@dsh-desktop', liveName))).toBe(true);
  });
});
describe('self-rescue: broken junction healing and quarantine', () => {
  const seedSource = (sourceRoot: string) => {
    for (const p of BUNDLED_DSH_PLUGINS) {
      const src = join(sourceRoot, p.directory); mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'index.js'), 'live', 'utf8'); writeFileSync(join(src, 'client.js'), 'c', 'utf8'); writeFileSync(join(src, 'package.json'), '{}', 'utf8');
    }
  };

  it('heals a broken profile junction on the next sync (folder-move fault, 2026-08-22)', () => {
    const dshHome = fresh(); const dshRuntimeRoot = fresh(); const sourceRoot = fresh();
    seedSource(sourceRoot);
    ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot });
    const first = BUNDLED_DSH_PLUGINS[0]!;
    const profilePackage = packageNodeModulesDir(join(dshHome, 'profiles', 'web'), first.packageName);
    // 制造断链：unlink 后指向一个不存在的旧绝对路径（模拟目录挪动后的状态）
    const oldPath = join(dshRuntimeRoot, 'moved-away', 'gone');
    try { unlinkSync(profilePackage); } catch { rmSync(profilePackage, { recursive: true, force: true }); }
    symlinkSync(oldPath, profilePackage, process.platform === 'win32' ? 'junction' : 'dir');
    expect(existsSync(profilePackage)).toBe(false);
    // 再同步：断链应被清理重建
    ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot });
    expect(existsSync(profilePackage)).toBe(true);
  });

  it('skips quarantined plugins during sync (they stay out until user restores)', () => {
    const dshHome = fresh(); const dshRuntimeRoot = fresh(); const sourceRoot = fresh();
    seedSource(sourceRoot);
    const quarantined = [BUNDLED_DSH_PLUGINS[0]!.packageName];
    ensureBundledDshPlugins({ dshHome, dshRuntimeRoot, sourceRoot, quarantined });
    const manifest = JSON.parse(readFileSync(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8'));
    const bundles = manifest.dsh.profile.bundles as string[];
    expect(bundles).not.toContain(quarantined[0]);
    for (const p of BUNDLED_DSH_PLUGINS.slice(1)) expect(bundles).toContain(p.packageName);
  });

});

describe('isolatedBundledNames（会话内存隔离名单映射）', () => {
  it('按 rowId 或 packageName 命中内置清单，返回对应包名', () => {
    const p = BUNDLED_DSH_PLUGINS[0]!;
    expect(isolatedBundledNames([p.rowId])).toEqual([p.packageName]);
    expect(isolatedBundledNames([p.packageName])).toEqual([p.packageName]);
  });

  it('多插件去重后按清单顺序返回；内置之外的名字被忽略', () => {
    const names = BUNDLED_DSH_PLUGINS.map((x) => x.packageName);
    const first = BUNDLED_DSH_PLUGINS[0]!.packageName;
    // 输入含重复 + 一个不存在的第三方包名 → 只返回内置的、去重
    expect(isolatedBundledNames([first, first, 'dsh-mobile', 'ghost'])).toEqual([first]);
    expect(isolatedBundledNames([])).toEqual([]);
  });

  it('全部内置被隔离 → 返回完整内置包名集合', () => {
    expect(isolatedBundledNames(BUNDLED_DSH_PLUGINS.map((x) => x.packageName))).toEqual(bundledPackageNames());
  });
});
