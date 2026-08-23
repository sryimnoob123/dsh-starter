import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDiagnosticReport, pruneOldReports, reportDirFor, writeDiagnosticReport, MAX_REPORTS } from './diagnosticReport.js';
import type { RepairContext } from './repairSession.js';

function makeCtx(overrides: Partial<RepairContext> = {}): RepairContext {
  return {
    cwd: 'C:\\work',
    rescueSummary: '[12:00:00] isolated dshmarket',
    isolatedPlugins: 'dshmarket',
    shellLogTail: 'shell log tail',
    serviceLogTail: 'service log tail',
    envSummary: 'deepseek-harness-starter v0.2.9 / 端口 3081 / profile web',
    ...overrides,
  };
}

describe('buildDiagnosticReport', () => {
  it('三段式结构：问题段 + 状态段 + 指令段齐全', () => {
    const text = buildDiagnosticReport({ kind: 'spawn-crash', problem: 'duplicate loader entry id: modlens', plugin: 'modlens', ctx: makeCtx() });
    expect(text).toContain('# DSH 桌面壳诊断报告');
    expect(text).toContain('## 一、问题');
    expect(text).toContain('duplicate loader entry id: modlens');
    expect(text).toContain('## 二、当前状态');
    expect(text).toContain('## 三、日志（shell.log 尾部）');
    expect(text).toContain('## 四、日志（service.log 尾部）');
    expect(text).toContain('## 五、请 DSH 协助');
    expect(text).toContain('肇事插件：modlens');
    expect(text).toContain('已移走（隔离）的插件');
  });

  it('无隔离插件/无自救事件时省略对应小节', () => {
    const text = buildDiagnosticReport({ kind: 'config-broken', problem: 'bad yaml', ctx: makeCtx({ rescueSummary: undefined, isolatedPlugins: undefined, serviceLogTail: undefined }) });
    expect(text).not.toContain('最近自救事件');
    expect(text).not.toContain('已移走（隔离）的插件');
    expect(text).not.toContain('## 四、日志');
  });

  it('问题文本过 redact 脱敏（API key 不落盘）', () => {
    const text = buildDiagnosticReport({ kind: 'spawn-crash', problem: 'sk-abc12345defghijklmnopqrstuv failed', ctx: makeCtx() });
    expect(text).not.toContain('sk-abc12345defghijklmnopqrstuv');
  });
});

describe('pruneOldReports', () => {
  it('超过上限删最老，保留最新 MAX_REPORTS 份', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diag-reports-'));
    try {
      for (let i = 0; i < MAX_REPORTS + 5; i++) {
        writeFileSync(join(dir, `diagnostic-${i}.md`), `report ${i}`, 'utf8');
        // 让 mtime 递增（同一毫秒内写入时 mtime 可能相同）
        const t = new Date(Date.now() + i * 1000);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('node:fs').utimesSync(join(dir, `diagnostic-${i}.md`), t, t);
      }
      const removed = pruneOldReports(dir);
      expect(removed.length).toBe(5);
      const remaining = require('node:fs').readdirSync(dir).filter((f: string) => f.endsWith('.md'));
      expect(remaining.length).toBe(MAX_REPORTS);
      expect(remaining).not.toContain('diagnostic-0.md');
      expect(remaining).toContain(`diagnostic-${MAX_REPORTS + 4}.md`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目录不存在 → 空数组无副作用', () => {
    expect(pruneOldReports(join(tmpdir(), 'no-such-dir-xyz'))).toEqual([]);
  });
});

describe('writeDiagnosticReport', () => {
  it('落盘 + 剪贴板 + 返回文件路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diag-write-'));
    let copied = '';
    try {
      const result = writeDiagnosticReport({ kind: 'hot-mount-failed', problem: 'hot mount of dsh-cost-balance failed', plugin: 'dsh-cost-balance', ctx: makeCtx(), reportDir: dir, copy: (t) => { copied = t; } });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.filePath.startsWith(dir)).toBe(true);
        expect(result.filePath.endsWith('.md')).toBe(true);
        const onDisk = readFileSync(result.filePath, 'utf8');
        expect(onDisk).toContain('hot mount of dsh-cost-balance failed');
        expect(onDisk).toContain('## 五、请 DSH 协助');
        expect(copied).toBe(onDisk);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('落盘失败（目录被文件占住）→ ok:false 但文本仍可读', () => {
    const dir = mkdtempSync(join(tmpdir(), 'diag-fail-'));
    try {
      // 用文件占住目录路径，mkdirSync 失败
      rmSync(dir, { recursive: true, force: true });
      writeFileSync(dir, 'blocker', 'utf8');
      const result = writeDiagnosticReport({ kind: 'spawn-crash', problem: 'x', ctx: makeCtx(), reportDir: dir });
      expect(result.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reportDirFor', () => {
  it('默认目录 = userData/diagnostic-reports', () => {
    expect(reportDirFor('C:\\Users\\me\\AppData\\Roaming\\dsh')).toBe('C:\\Users\\me\\AppData\\Roaming\\dsh\\diagnostic-reports');
  });
});
