import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureWinTerminalInspector,
  profilePatchPath,
  profilePluginDir,
  WIN_INSPECTOR_ROW_ID,
  withInspectorPatchEntry,
} from './winInspectorPlugin.js';

const DSH_DEFAULT_PATCH = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
].join('\n');

const tempDirs: string[] = [];
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-win-inspector-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('withInspectorPatchEntry（幂等合并 profile patch）', () => {
  it('把 DSH 默认的空数组 [] 替换成 insert 条目', () => {
    const out = withInspectorPatchEntry(DSH_DEFAULT_PATCH);
    expect(out).toContain(`id: ${WIN_INSPECTOR_ROW_ID}`);
    expect(out).toContain('name: ./plugins/dsh-win-terminal-inspector/index.js');
    expect(out).not.toContain('[]');
    // 原有注释头保留
    expect(out).toContain('applied after every bundle layer');
  });

  it('已存在该 id 时原样返回，不重复、不覆盖', () => {
    const withEntry = withInspectorPatchEntry(DSH_DEFAULT_PATCH);
    const again = withInspectorPatchEntry(withEntry);
    expect(again).toBe(withEntry);
  });

  it('已有其他条目时只在末尾追加，不动已有内容', () => {
    const existing = [
      '- insert:',
      '    - id: someone-else',
      '      name: ./plugins/other/index.js',
    ].join('\n');
    const out = withInspectorPatchEntry(existing);
    expect(out.indexOf('someone-else')).toBeLessThan(out.indexOf(WIN_INSPECTOR_ROW_ID));
    expect(out.match(new RegExp(`id: ${WIN_INSPECTOR_ROW_ID}`, 'g'))).toHaveLength(1);
  });

  it('空字符串（patch 不存在）也产出合法单条目', () => {
    const out = withInspectorPatchEntry('');
    expect(out.trim()).toContain(`- insert:`);
    expect(out.trim()).toContain(`id: ${WIN_INSPECTOR_ROW_ID}`);
  });
});

describe('ensureWinTerminalInspector', () => {
  it('非 win32 no-op，不创建任何目录', () => {
    const home = freshHome();
    const source = freshHome();
    const changed = ensureWinTerminalInspector({ dshHome: home, sourceDir: source, platform: 'linux' });
    expect(changed).toBe(false);
    expect(existsSync(join(home, 'profiles'))).toBe(false);
  });

  it('win32 首次：拷贝插件文件 + 写 patch，返回 true', () => {
    const home = freshHome();
    const source = freshHome();
    // 伪造源文件
    mkdirSync(join(source, 'lib'), { recursive: true });
    writeFileSync(join(source, 'index.js'), 'export const name="x";', 'utf8');
    writeFileSync(join(source, 'package.json'), '{}', 'utf8');
    writeFileSync(join(source, 'lib', 'inspector.js'), 'export class X {}', 'utf8');
    // 预置 DSH 默认 profile patch
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true });
    writeFileSync(profilePatchPath(home), DSH_DEFAULT_PATCH, 'utf8');

    const changed = ensureWinTerminalInspector({ dshHome: home, sourceDir: source, platform: 'win32' });
    expect(changed).toBe(true);
    expect(readFileSync(join(profilePluginDir(home), 'index.js'), 'utf8')).toContain('name="x"');
    expect(readFileSync(join(profilePluginDir(home), 'lib', 'inspector.js'), 'utf8')).toContain('class X');
    expect(readFileSync(profilePatchPath(home), 'utf8')).toContain(`id: ${WIN_INSPECTOR_ROW_ID}`);
  });

  it('win32 二次调用幂等：返回 false，patch 不再变化', () => {
    const home = freshHome();
    const source = freshHome();
    mkdirSync(join(source, 'lib'), { recursive: true });
    writeFileSync(join(source, 'index.js'), 'x', 'utf8');
    writeFileSync(join(source, 'package.json'), '{}', 'utf8');
    writeFileSync(join(source, 'lib', 'inspector.js'), 'y', 'utf8');
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true });
    writeFileSync(profilePatchPath(home), DSH_DEFAULT_PATCH, 'utf8');

    expect(ensureWinTerminalInspector({ dshHome: home, sourceDir: source, platform: 'win32' })).toBe(true);
    const afterFirst = readFileSync(profilePatchPath(home), 'utf8');
    expect(ensureWinTerminalInspector({ dshHome: home, sourceDir: source, platform: 'win32' })).toBe(false);
    expect(readFileSync(profilePatchPath(home), 'utf8')).toBe(afterFirst);
  });
});
