import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLogTail, tailText } from './readLog.js';

describe('tailText（尾部截断，从行首对齐）', () => {
  it('小于上限时全文返回', () => {
    expect(tailText('a\nb\nc', 100)).toBe('a\nb\nc');
  });

  it('超过上限时截断并从下一行行首对齐', () => {
    const text = 'line1\nline2\nline3\nline4\n';
    expect(tailText(text, 12)).toBe('line4\n');
  });

  it('maxBytes 为 0 时返回空串', () => {
    expect(tailText('a\nb', 0)).toBe('');
  });

  it('截断片段无换行符时原样返回该片段', () => {
    expect(tailText('xxxxx\nyyyy', 3)).toBe('yyy');
  });
});

describe('readLogTail', () => {
  it('返回脱敏后的日志尾部', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-readlog-'));
    const file = join(dir, 'shell.log');
    writeFileSync(file, 'ok line\nsk-abcdefghijklmnopqrstuvwxyz123456 token\n');
    expect(readLogTail(file)).toBe('ok line\n[REDACTED] token\n');
  });

  it('文件不存在时返回空串（不抛错）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-readlog-'));
    expect(readLogTail(join(dir, 'nope.log'))).toBe('');
  });

  it('超长文件只返回末尾部分', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-readlog-'));
    const file = join(dir, 'service.log');
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`).join('\n') + '\nEND-MARK\n';
    writeFileSync(file, lines);
    const result = readLogTail(file, 512);
    expect(result.endsWith('END-MARK\n')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(600);
  });
});
