import { describe, expect, it } from 'vitest';
import { isAbsoluteFilePath, resolveFilePath } from './path.js';

describe('isAbsoluteFilePath', () => {
  it.each(['C:\\a\\b.ts', 'C:/a/b.ts', '/a/b.ts', '\\\\server\\share\\a.ts'])(
    '识别绝对路径 %s',
    (p) => {
      expect(isAbsoluteFilePath(p)).toBe(true);
    },
  );

  it.each(['src/a.ts', 'a.ts', '.\\a.ts', '..\\a.ts'])('识别相对路径 %s', (p) => {
    expect(isAbsoluteFilePath(p)).toBe(false);
  });
});

describe('resolveFilePath', () => {
  it('绝对路径原样返回（不拼 cwd）', () => {
    expect(resolveFilePath('C:\\ws', 'C:\\other\\a.ts')).toBe('C:\\other\\a.ts');
    expect(resolveFilePath('C:\\ws', '/root/a.ts')).toBe('/root/a.ts');
  });

  it('相对路径按 cwd 拼接（正斜杠归一到平台分隔符）', () => {
    expect(resolveFilePath('C:\\ws', 'src\\a.ts')).toBe('C:\\ws\\src\\a.ts');
    expect(resolveFilePath('C:\\ws', 'src/a.ts')).toBe('C:\\ws\\src\\a.ts');
  });

  it('cwd 缺失时原样返回（与 DSH resolveWorkspacePath 一致）', () => {
    expect(resolveFilePath(undefined, 'src/a.ts')).toBe('src/a.ts');
    expect(resolveFilePath('', 'src/a.ts')).toBe('src/a.ts');
  });
});
