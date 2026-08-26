import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDirWritable, checkTempWritable } from './writableCheck.js';

describe('checkDirWritable（试写探针）', () => {
  it('可写目录 → ok', () => {
    const dir = join(tmpdir(), `wchk-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    const r = checkDirWritable(dir);
    expect(r.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('不存在目录 → 失败（探针写不进去）', () => {
    const dir = join(tmpdir(), `wchk-missing-${Date.now()}`);
    const r = checkDirWritable(dir);
    expect(r.ok).toBe(false);
  });

  it('空目录参数 → 失败', () => {
    const r = checkDirWritable('');
    expect(r.ok).toBe(false);
    expect(r.detail).toBe('empty dir');
  });

  it('探针文件清理干净（无残留）', () => {
    const dir = join(tmpdir(), `wchk-clean-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    checkDirWritable(dir);
    const leftovers = require('node:fs').readdirSync(dir).filter((n: string) => n.includes('.dsh-write-probe-'));
    expect(leftovers).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('checkTempWritable', () => {
  it('%TEMP% 可写 → ok', () => {
    const r = checkTempWritable();
    expect(r.ok).toBe(true);
  });
});
