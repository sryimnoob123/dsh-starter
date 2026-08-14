import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maybeRotateLog } from './rotate.js';

describe('maybeRotateLog（日志轮转）', () => {
  it('未超上限：不动', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rotate-'));
    try {
      const file = join(dir, 'shell.log');
      writeFileSync(file, 'small');
      maybeRotateLog(file, 100);
      expect(statSync(file).size).toBe(5);
      expect(() => statSync(`${file}.old`)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('超上限：改名 .old（覆盖旧 .old），原路径腾空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rotate-'));
    try {
      const file = join(dir, 'shell.log');
      writeFileSync(file, 'x'.repeat(200));
      writeFileSync(`${file}.old`, 'stale');
      maybeRotateLog(file, 100);
      expect(() => statSync(file)).toThrow();
      expect(statSync(`${file}.old`).size).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('文件不存在：不动（不抛）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-rotate-'));
    try {
      expect(() => maybeRotateLog(join(dir, 'nope.log'))).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
