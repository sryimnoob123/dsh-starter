import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listPlugins, setPluginEnabled, setPluginRemoved } from './pluginManager.js';

/** 造一个临时的"壳安装目录"：dsh-home/profiles/web/package.json + node_modules 下的几个插件。 */
function makeEnv(pluginSpecs: Array<{ pkg: string; entryId: string; description?: string }>): string {
  const installDir = mkdtempSync(join(tmpdir(), 'dsh-plugman-'));
  const profileDir = join(installDir, 'dsh-home', 'profiles', 'web');
  const nm = join(profileDir, 'node_modules');
  mkdirSync(nm, { recursive: true });

  const bundles: string[] = [];
  const dependencies: Record<string, string> = {};
  for (const spec of pluginSpecs) {
    const dir = join(nm, spec.pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: spec.pkg,
      description: spec.description,
    }), 'utf8');
    writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${spec.entryId}\n      name: '${spec.pkg}'\n`, 'utf8');
    if (spec.pkg.startsWith('@deepseek-ai/')) {
      // 核心组件只进 bundles，不进 dependencies（模拟）
      bundles.push(spec.pkg);
    } else {
      bundles.push(spec.pkg);
      dependencies[spec.pkg] = '^1.0.0';
    }
  }
  // 一个"已装但未挂载"的第三方（只在 dependencies，不在 bundles）
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }, null, 2), 'utf8');
  return installDir;
}

function cleanup(installDir: string): void {
  rmSync(installDir, { recursive: true, force: true });
}

/** 读 profile 层 cordis.patch.yml（不存在返回 ''） */
function readPatch(installDir: string): string {
  const p = join(installDir, 'dsh-home', 'profiles', 'web', 'cordis.patch.yml');
  return existsSync(p) ? require('node:fs').readFileSync(p, 'utf8') : '';
}

describe('listPlugins', () => {
  it('从 bundles 枚举插件，读 entry id + 描述；核心组件只读', () => {
    const dir = makeEnv([
      { pkg: '@deepseek-ai/dsh-base', entryId: 'dsh-base', description: 'base core' },
      { pkg: '@deepseek-ai/dsh-web-app', entryId: 'web-runtime', description: 'web core' },
      { pkg: 'dsh-better-sidebar', entryId: 'better-sidebar', description: 'side bar' },
    ]);
    try {
      const rows = listPlugins(dir);
      const base = rows.find((r) => r.name === '@deepseek-ai/dsh-base');
      expect(base?.toggleable).toBe(false);
      expect(base?.description).toBe('base core');
      const sidebar = rows.find((r) => r.name === 'dsh-better-sidebar');
      expect(sidebar?.id).toBe('better-sidebar');
      expect(sidebar?.toggleable).toBe(true);
      expect(sidebar?.enabled).toBe(true);
    } finally { cleanup(dir); }
  });

  it('dependencies 里已装但未挂载的插件也列出；entry id 从包内 patch 提取（非 rowId）', () => {
    const dir = makeEnv([
      { pkg: 'dsh-boot-guard', entryId: 'boot-guard', description: '' },
      { pkg: 'dsh-undo-savepoint', entryId: 'dsh-undo', description: 'undo' },
    ]);
    try {
      const rows = listPlugins(dir);
      expect(rows.some((r) => r.id === 'boot-guard')).toBe(true);
      expect(rows.some((r) => r.id === 'dsh-undo')).toBe(true);
    } finally { cleanup(dir); }
  });

  it('profile 层 disabled 条目反推 enabled=false', () => {
    const dir = makeEnv([
      { pkg: 'dsh-better-sidebar', entryId: 'better-sidebar', description: '' },
      { pkg: 'dsh-context', entryId: 'dsh-context', description: '' },
    ]);
    try {
      // 手动在 profile 层 cordis.patch.yml 写 disabled
      const patchDir = join(dir, 'dsh-home', 'profiles', 'web');
      writeFileSync(join(patchDir, 'cordis.patch.yml'), '- id: better-sidebar\n  disabled: true\n', 'utf8');
      const rows = listPlugins(dir);
      expect(rows.find((r) => r.id === 'better-sidebar')?.enabled).toBe(false);
      expect(rows.find((r) => r.id === 'dsh-context')?.enabled).toBe(true);
    } finally { cleanup(dir); }
  });
});

describe('setPluginEnabled', () => {
  it('关插件 → 追加 disabled 条目；再开 → 移除条目（幂等）', () => {
    const dir = makeEnv([{ pkg: 'dsh-better-sidebar', entryId: 'better-sidebar', description: '' }]);
    try {
      const off = setPluginEnabled(dir, 'better-sidebar', false);
      expect(off).toEqual({ ok: true });
      expect(readPatch(dir)).toContain('- id: better-sidebar');
      expect(readPatch(dir)).toContain('disabled: true');

      const on = setPluginEnabled(dir, 'better-sidebar', true);
      expect(on).toEqual({ ok: true });
      expect(readPatch(dir)).not.toContain('disabled: true');

      // 幂等：再关再开不报错
      expect(setPluginEnabled(dir, 'better-sidebar', false)).toEqual({ ok: true });
      expect(setPluginEnabled(dir, 'better-sidebar', true)).toEqual({ ok: true });
    } finally { cleanup(dir); }
  });

  it('核心组件拒绝开关；未知插件报错', () => {
    const dir = makeEnv([{ pkg: '@deepseek-ai/dsh-base', entryId: 'dsh-base', description: '' }]);
    try {
      const res = setPluginEnabled(dir, 'dsh-base', false);
      expect(res.ok).toBe(false);
      expect(setPluginEnabled(dir, 'ghost-plugin', false).ok).toBe(false);
    } finally { cleanup(dir); }
  });
});

describe('setPluginRemoved（移除/恢复插件，@deepseek-ai/dsh-plugin-manager setRemoved 桥）', () => {
  it('移除 → 删 insert 块 + 标 disabled；list 显示 removed；恢复 → 读回 insert 块 + 清 disabled', () => {
    const dir = makeEnv([{ pkg: 'dsh-better-sidebar', entryId: 'better-sidebar', description: '' }]);
    try {
      // 初始：profile 层 patch 有 insert 块（makeEnv 的包内 patch 不会自动进 profile 层，
      // 这里模拟 dsh 已挂载：手动写 insert 块）
      const patchDir = join(dir, 'dsh-home', 'profiles', 'web');
      writeFileSync(join(patchDir, 'cordis.patch.yml'), '- insert:\n    - id: better-sidebar\n      name: dsh-better-sidebar\n', 'utf8');

      const off = setPluginRemoved(dir, 'better-sidebar', true);
      expect(off).toEqual({ ok: true });
      const patchAfterRemove = readPatch(dir);
      expect(patchAfterRemove).not.toContain('insert:');
      expect(patchAfterRemove).toContain('disabled: true');
      expect(listPlugins(dir).find((r) => r.id === 'better-sidebar')?.removed).toBe(true);
      expect(listPlugins(dir).find((r) => r.id === 'better-sidebar')?.enabled).toBe(false);

      const on = setPluginRemoved(dir, 'better-sidebar', false);
      expect(on).toEqual({ ok: true });
      const patchAfterRestore = readPatch(dir);
      expect(patchAfterRestore).toContain('insert:');
      expect(patchAfterRestore).toContain('id: better-sidebar');
      expect(patchAfterRestore).not.toContain('disabled: true');
      expect(listPlugins(dir).find((r) => r.id === 'better-sidebar')?.removed).toBe(false);
      expect(listPlugins(dir).find((r) => r.id === 'better-sidebar')?.enabled).toBe(true);
    } finally { cleanup(dir); }
  });

  it('核心组件拒绝移除；未知插件报错', () => {
    const dir = makeEnv([{ pkg: '@deepseek-ai/dsh-base', entryId: 'dsh-base', description: '' }]);
    try {
      const res = setPluginRemoved(dir, 'dsh-base', true);
      expect(res.ok).toBe(false);
      expect(setPluginRemoved(dir, 'ghost-plugin', true).ok).toBe(false);
    } finally { cleanup(dir); }
  });
});
