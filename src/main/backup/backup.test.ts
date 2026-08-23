import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDshHome } from './backup.js';
function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-backup-'));
  // 顶层
  mkdirSync(join(dir, 'profiles', 'web', 'node_modules'), { recursive: true });
  mkdirSync(join(dir, 'profiles', 'web', 'plugins'), { recursive: true });
  mkdirSync(join(dir, 'profiles', 'web', '.dsh-market'), { recursive: true });
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, '.cache'), { recursive: true });
  mkdirSync(join(dir, 'storages'), { recursive: true });
  // 文件
  writeFileSync(join(dir, 'settings.yaml'), 'theme: dark\n', 'utf8');
  writeFileSync(join(dir, 'AGENTS.md'), '# rules\n', 'utf8');
  writeFileSync(join(dir, '.credentials.yaml'), 'key: secret\n', 'utf8');
  writeFileSync(join(dir, 'profiles', 'web', 'package.json'), '{"name":"web"}\n', 'utf8');
  writeFileSync(join(dir, 'profiles', 'web', 'cordis.patch.yml'), '- id: x\n', 'utf8');
  writeFileSync(join(dir, 'profiles', 'web', 'node_modules', 'plugin.js'), 'x', 'utf8');
  writeFileSync(join(dir, 'profiles', 'web', 'plugins', 'plugin.js'), 'x', 'utf8');
  writeFileSync(join(dir, 'sessions', 's1.json'), '{}', 'utf8');
  writeFileSync(join(dir, '.cache', 'cached.js'), 'x', 'utf8');
  writeFileSync(join(dir, 'storages', 's.json'), '{}', 'utf8');
  return dir;
}

describe('backupDshHome（数据备份）', () => {
  it('备份配置 + 会话，排除 node_modules/凭据/缓存', async () => {
    const home = makeHome();
    const target = mkdtempSync(join(tmpdir(), 'dsh-backup-target-'));
    try {
      const result = await backupDshHome({ dshHome: home, targetRoot: target });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.copied).toBeGreaterThan(0);
      // 配置备份了
      expect(existsSync(join(result.backupRoot, 'profiles', 'web', 'package.json'))).toBe(true);
      expect(existsSync(join(result.backupRoot, 'profiles', 'web', 'cordis.patch.yml'))).toBe(true);
      expect(existsSync(join(result.backupRoot, 'settings.yaml'))).toBe(true);
      expect(existsSync(join(result.backupRoot, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(result.backupRoot, 'sessions', 's1.json'))).toBe(true);
      expect(existsSync(join(result.backupRoot, 'storages', 's.json'))).toBe(true);
      // 隐私/可重装排除
      expect(existsSync(join(result.backupRoot, '.credentials.yaml'))).toBe(false);
      expect(existsSync(join(result.backupRoot, '.cache'))).toBe(false);
      expect(existsSync(join(result.backupRoot, 'profiles', 'web', 'node_modules'))).toBe(false);
      // 插件实体排除（配置已备份，实体可重装）
      expect(existsSync(join(result.backupRoot, 'profiles', 'web', 'plugins'))).toBe(false);
      // 跳过清单记录
      expect(result.skipped).toContain('.credentials.yaml');
      expect(result.skipped).toContain('.cache');
      expect(result.skipped).toContain('node_modules');
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('dsh-home 不存在 → 明确报错', async () => {
    const result = await backupDshHome({ dshHome: 'Z:\\no-such-home', targetRoot: tmpdir() });
    expect(result.ok).toBe(false);
  });
});
