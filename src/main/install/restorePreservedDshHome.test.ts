import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  tryRestorePreservedDshHome,
  tryRestoreBackupDshHome,
  backupDshHomeBeforeUpdate,
  preserveDir,
  backupDir,
} from './restorePreservedDshHome.js';

function makeEnv(tempRoot: string) {
  const preserve = preserveDir(tempRoot);
  const web = join(preserve, 'profiles', 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, 'package.json'), '{"name":"web"}', 'utf8');
  mkdirSync(join(preserve, 'skills'), { recursive: true });
  writeFileSync(join(preserve, 'skills', 'SKILL.md'), '---\nname: demo\n---\ncontent', 'utf8');
  writeFileSync(join(preserve, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n', 'utf8');
  return preserve;
}

describe('tryRestorePreservedDshHome（P0 数据丢失壳侧兜底）', () => {
  it('无保留目录 → 不动，返回 no-preserve-dir', () => {
    const tempRoot = join(tmpdir(), `rst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const dshHome = join(tempRoot, 'dsh-home');
    const r = tryRestorePreservedDshHome(dshHome, tempRoot);
    expect(r).toEqual({ restored: false, detail: 'no-preserve-dir' });
  });

  it('保留目录有数据 + 目标空壳 → 整体恢复（含 skills）', () => {
    const tempRoot = join(tmpdir(), `rst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    makeEnv(tempRoot);
    const dshHome = join(tempRoot, 'dsh-home');
    mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true }); // 空壳（用户数据已丢）
    const r = tryRestorePreservedDshHome(dshHome, tempRoot);
    expect(r.restored).toBe(true);
    expect(r.detail).toBe('restored-from-preserve');
    expect(existsSync(join(dshHome, 'skills', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dshHome, 'settings.yaml'))).toBe(true);
  });

  it('目标已有完整数据 → 不覆盖（用户已重建）', () => {
    const tempRoot = join(tmpdir(), `rst-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    makeEnv(tempRoot);
    const dshHome = join(tempRoot, 'dsh-home');
    const web = join(dshHome, 'profiles', 'web');
    mkdirSync(web, { recursive: true });
    writeFileSync(join(web, 'package.json'), '{"name":"user-rebuilt"}', 'utf8');
    const r = tryRestorePreservedDshHome(dshHome, tempRoot);
    expect(r.restored).toBe(false);
    expect(r.detail).toBe('existing-dsh-home-kept');
    expect(existsSync(join(dshHome, 'skills', 'SKILL.md'))).toBe(false); // 未覆盖
  });
});

describe('backupDshHomeBeforeUpdate + tryRestoreBackupDshHome（2026-08-25 止血补丁）', () => {
  it('更新前备份 dsh-home → 备份目录含全部数据', () => {
    const tempRoot = join(tmpdir(), `bk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const dshHome = join(tempRoot, 'dsh-home');
    const web = join(dshHome, 'profiles', 'web');
    mkdirSync(web, { recursive: true });
    writeFileSync(join(web, 'package.json'), '{"name":"web"}', 'utf8');
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    writeFileSync(join(dshHome, 'skills', 'my-skill.md'), 'my skill', 'utf8');
    writeFileSync(join(dshHome, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n', 'utf8');

    const r = backupDshHomeBeforeUpdate(dshHome, tempRoot);
    expect(r.backedUp).toBe(true);
    expect(existsSync(join(backupDir(tempRoot), 'skills', 'my-skill.md'))).toBe(true);
    expect(existsSync(join(backupDir(tempRoot), 'settings.yaml'))).toBe(true);
  });

  it('dsh-home 不存在 → 不备份，返回 no-dsh-home', () => {
    const tempRoot = join(tmpdir(), `bk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const r = backupDshHomeBeforeUpdate(join(tempRoot, 'missing'), tempRoot);
    expect(r).toEqual({ backedUp: false, detail: 'no-dsh-home' });
  });

  it('更新后 dsh-home 空壳 → 从备份恢复（含 skills）', () => {
    const tempRoot = join(tmpdir(), `bk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const dshHome = join(tempRoot, 'dsh-home');
    const web = join(dshHome, 'profiles', 'web');
    mkdirSync(web, { recursive: true });
    writeFileSync(join(web, 'package.json'), '{"name":"web"}', 'utf8');
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    writeFileSync(join(dshHome, 'skills', 'my-skill.md'), 'my skill', 'utf8');
    writeFileSync(join(dshHome, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n', 'utf8');
    backupDshHomeBeforeUpdate(dshHome, tempRoot);

    // 模拟更新：dsh-home 被整目录删除（NSIS 宏失效场景），只剩空壳
    rmSync(dshHome, { recursive: true, force: true });
    mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true }); // 空壳
    const r = tryRestoreBackupDshHome(dshHome, tempRoot);
    expect(r.restored).toBe(true);
    expect(r.detail).toBe('restored-from-backup');
    expect(existsSync(join(dshHome, 'skills', 'my-skill.md'))).toBe(true);
    expect(existsSync(join(dshHome, 'settings.yaml'))).toBe(true);
  });

  it('无备份目录 → 不动，返回 no-backup-dir', () => {
    const tempRoot = join(tmpdir(), `bk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const dshHome = join(tempRoot, 'dsh-home');
    const r = tryRestoreBackupDshHome(dshHome, tempRoot);
    expect(r).toEqual({ restored: false, detail: 'no-backup-dir' });
  });

  it('目标已有完整数据 → 不覆盖（用户已重建）', () => {
    const tempRoot = join(tmpdir(), `bk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const dshHome = join(tempRoot, 'dsh-home');
    const web = join(dshHome, 'profiles', 'web');
    mkdirSync(web, { recursive: true });
    writeFileSync(join(web, 'package.json'), '{"name":"web"}', 'utf8');
    mkdirSync(join(dshHome, 'skills'), { recursive: true });
    writeFileSync(join(dshHome, 'skills', 'my-skill.md'), 'my skill', 'utf8');
    backupDshHomeBeforeUpdate(dshHome, tempRoot);

    // 用户已重建（web profile 有内容）→ 不覆盖
    const rebuilt = join(tempRoot, 'dsh-home');
    writeFileSync(join(rebuilt, 'profiles', 'web', 'package.json'), '{"name":"user-rebuilt"}', 'utf8');
    const r = tryRestoreBackupDshHome(rebuilt, tempRoot);
    expect(r.restored).toBe(false);
    expect(r.detail).toBe('existing-dsh-home-kept');
  });
});
