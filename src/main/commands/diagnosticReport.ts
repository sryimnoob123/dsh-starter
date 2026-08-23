/**
 * 诊断报告（2026-08-23 用户拍板：任何检测到的问题都要给用户一段「可直接发给 DSH 的诊断信息」）：
 * 三段式 markdown（问题段[脱敏日志/错误类型/肇事插件] + 状态段[插件清单/被移走插件+隔离区路径/快照位置]
 * + 指令段[DSH 如何修如何恢复]），自动复制到剪贴板 + 落盘 .md（环形保留 20 份，超过删最老）。
 * 最坏情况（插件全挂、DSH 被迫干净启动）下，凭这段文本也能修复 + 恢复之前状态。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from '../logging/redact.js';
import { readLogTail } from '../logging/readLog.js';
import { logFile } from '../logging/paths.js';
import type { RepairContext } from './repairSession.js';

/** 报告保留上限（用户拍板：环形 20 份，超过自动删最老） */
export const MAX_REPORTS = 20;

export interface DiagnosticReportInput {
  /** 问题类型（如 'spawn-crash' / 'hot-mount-failed' / 'config-broken'） */
  kind: string;
  /** 问题描述（已脱敏或原文，落盘前统一再过 redact） */
  problem: string;
  /** 肇事插件（可选） */
  plugin?: string;
  /** 修复会话上下文（cwd/自救事件/隔离插件/日志尾部/环境） */
  ctx: RepairContext;
  /** 报告落盘目录（默认 userData/diagnostic-reports/） */
  reportDir?: string;
  /** 剪贴板写入实现（壳注入 electron clipboard；测试注入 fake；不注入则跳过复制） */
  copy?: (text: string) => void;
}

/** 纯函数：组装三段式诊断报告 markdown（问题段 + 状态段 + 指令段） */
export function buildDiagnosticReport(input: DiagnosticReportInput): string {
  const lines: string[] = [
    '# DSH 桌面壳诊断报告',
    '',
    `- 生成时间：${new Date().toLocaleString()}`,
    `- 问题类型：${input.kind}`,
    `- 环境：${input.ctx.envSummary}`,
  ];
  if (input.plugin) lines.push(`- 肇事插件：${input.plugin}`);
  lines.push('', '## 一、问题', redact(input.problem));
  lines.push('', '## 二、当前状态');
  if (input.ctx.rescueSummary) {
    lines.push('', '### 最近自救事件', input.ctx.rescueSummary);
  }
  if (input.ctx.isolatedPlugins) {
    lines.push('', '### 已移走（隔离）的插件', input.ctx.isolatedPlugins, '（实体保留在隔离区，可一键恢复）');
  }
  lines.push('', '### 插件清单', '（见设置页「插件 → 管理」；被移走插件可在恢复弹窗一键装回）');
  lines.push('', '## 三、日志（shell.log 尾部）', input.ctx.shellLogTail);
  if (input.ctx.serviceLogTail) {
    lines.push('', '## 四、日志（service.log 尾部）', input.ctx.serviceLogTail);
  }
  lines.push('', '## 五、请 DSH 协助', '- 定位根因并给出修复步骤；', '- 涉及配置/插件改动的，给出具体文件路径与改动内容；', '- 需要恢复被移走插件的，说明恢复步骤（壳内「恢复插件」按钮可一键装回）。');
  return lines.join('\n');
}

/** 纯函数：报告落盘目录（默认 userData/diagnostic-reports/） */
export function reportDirFor(userData: string): string {
  return join(userData, 'diagnostic-reports');
}

/** 纯函数：环形保留——目录内报告超过 MAX_REPORTS 份时删最老（按 mtime），返回删除的文件名列表 */
export function pruneOldReports(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const removed: string[] = [];
  while (files.length > MAX_REPORTS) {
    const oldest = files.shift();
    if (oldest) {
      rmSync(join(dir, oldest.f), { force: true });
      removed.push(oldest.f);
    }
  }
  return removed;
}

/**
 * 生成诊断报告：组装 markdown → 落盘（环形保留 20 份）→ 复制到剪贴板。
 * 返回 { ok: true, filePath, text } 或 { ok: false, error }（落盘失败不阻断剪贴板）。
 */
export function writeDiagnosticReport(input: DiagnosticReportInput): { ok: true; filePath: string; text: string } | { ok: false; error: string } {
  const text = buildDiagnosticReport(input);
  const dir = input.reportDir ?? reportDirFor('');
  try {
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `diagnostic-${Date.now()}.md`);
    writeFileSync(filePath, text, 'utf8');
    pruneOldReports(dir);
    input.copy?.(text);
    return { ok: true, filePath, text };
  } catch (error) {
    // 落盘失败不阻断剪贴板（最坏情况也要能发给 DSH）
    try { input.copy?.(text); } catch { /* 剪贴板也失败则放弃 */ }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `报告落盘失败：${detail}` };
  }
}
