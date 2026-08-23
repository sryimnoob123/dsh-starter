import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLogTail, tailText, stripAnsi, filterKeyLines, lastEventWindow, readDiagnosticLogTail } from './readLog.js';

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

describe('stripAnsi（剥 TUI 渲染转义）', () => {
  it('剥掉颜色/光标控制序列，保留正文', () => {
    const text = '\u001b[38;2;85;96;111m╭╮\u001b[0m\n\u001b[34m❯\u001b[0m █\u001b[0m\nnormal\u001b[2A\u001b[3G\u001b[?2026l';
    expect(stripAnsi(text)).toBe('╭╮\n❯ █\nnormal');
  });

  it('无 ANSI 时原样返回', () => {
    expect(stripAnsi('plain line')).toBe('plain line');
  });
});

describe('filterKeyLines（只留关键行）', () => {
  it('只保留含错误/自救特征的行，丢弃无关行', () => {
    const text = [
      'normal info line',
      'spawn failed: Error: dsh exited with code 1',
      'self-rescue outcome: {"action":"repaired"}',
      'service ready on port 3081',
      'duplicate loader entry id: usage-stats',
    ].join('\n');
    const result = filterKeyLines(text);
    expect(result).toContain('spawn failed');
    expect(result).toContain('self-rescue outcome');
    expect(result).toContain('duplicate loader entry id');
    expect(result).not.toContain('normal info line');
    expect(result).not.toContain('service ready');
  });

  it('超过 maxLines 只保留末尾部分', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `error line ${i}`);
    const result = filterKeyLines(lines.join('\n'), 50);
    expect(result.split('\n').length).toBe(50);
    expect(result).toContain('error line 199');
    expect(result).not.toContain('error line 0');
  });
});

describe('lastEventWindow（最近一次关键事件窗口）', () => {
  it('从最后一次崩溃/自救行开始取到末尾，历史事件丢弃', () => {
    const text = [
      'old error 1',
      'self-rescue outcome: {"action":"repaired","target":"modlens"}',
      'service ready on port 3081',
      'normal line',
      'spawn failed: Error: dsh exited with code 1',
      'self-rescue outcome: {"action":"isolated","pluginId":"dsh-ibka-balance"}',
      'restarting shell',
    ].join('\n');
    const result = lastEventWindow(text);
    expect(result).toContain('spawn failed');
    expect(result).toContain('dsh-ibka-balance');
    expect(result).not.toContain('modlens');
    expect(result).not.toContain('old error 1');
  });

  it('无关键事件时原样返回', () => {
    expect(lastEventWindow('a\nb\nc')).toBe('a\nb\nc');
  });
});

describe('readDiagnosticLogTail（诊断场景：截尾 + 剥 ANSI + 最近事件窗口 + 限行 + 脱敏）', () => {
  it('返回剥 ANSI 后的最近事件窗口且脱敏', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-diaglog-'));
    const file = join(dir, 'service.log');
    writeFileSync(file, [
      '\u001b[38;2;85;96;111m╭╮\u001b[0m',
      'old error: duplicate loader entry id: modlens',
      'service ready on port 3081',
      'spawn failed: Error: dsh exited with code 1',
      'sk-abcdefghijklmnopqrstuvwxyz123456 token leaked',
      'self-rescue outcome: {"action":"isolated","pluginId":"dsh-ibka-balance"}',
    ].join('\n'), 'utf8');
    const result = readDiagnosticLogTail(file);
    expect(result).toContain('spawn failed');
    expect(result).toContain('dsh-ibka-balance');
    expect(result).not.toContain('╭╮');
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result).not.toContain('modlens');
    expect(result).not.toContain('service ready');
  });

  it('文件不存在时返回空串', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-diaglog-'));
    expect(readDiagnosticLogTail(join(dir, 'nope.log'))).toBe('');
  });
});
