import { readFileSync } from 'node:fs';
import { redact } from './redact.js';

/**
 * 日志查看（logs.html 的 readLog(kind) 与托盘"查看日志"共用）：
 * 只返回文件尾部（默认 256K 字符，防日志过大拖垮页面），并复用 redact 脱敏。
 */

/** 纯函数：按 UTF-8 字节截取文本尾部 maxBytes，并从下一行行首对齐（不返回半行、不劈开多字节字符） */
export function tailText(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  // 从末尾逐字符回退，按每字符的实际 UTF-8 字节数累计，直到达到上限（停在字符边界）
  let start = text.length;
  let count = 0;
  while (start > 0 && count < maxBytes) {
    start -= 1;
    count += Buffer.byteLength(text[start], 'utf8');
  }
  const tail = text.slice(start);
  const nl = tail.indexOf('\n');
  return nl === -1 ? tail : tail.slice(nl + 1);
}

/** 纯函数：剥掉 ANSI 转义序列（TUI 渲染字符，对排错无价值且占体积） */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
}

/** 纯函数：只保留"关键行"（含错误/失败/自救/崩溃特征的行），其余丢弃；上限 maxLines 行 */
export function filterKeyLines(text: string, maxLines = 120): string {
  const KEY = /error|fail|crash|duplicate|self-rescue|isolat|repair|spawn|exit|fatal|unable|reject|denied|refused|timeout|exception|throw/i;
  const lines = text.split(/\r?\n/).filter((l) => KEY.test(l));
  return lines.slice(-maxLines).join('\n');
}

export function readLogTail(filePath: string, maxBytes = 256 * 1024): string {
  try {
    return redact(tailText(readFileSync(filePath, 'utf8'), maxBytes));
  } catch {
    // 文件不存在/读失败：返回空串，页面显示"暂无日志"
    return '';
  }
}

/** 纯函数：截取"最近一次关键事件"窗口——从最后一次根因行（崩溃/错误）开始到末尾。
 *  排错最需要根因（spawn failed / Error: / duplicate loader），其后的处置行（self-rescue
 *  outcome 等）自然包含在窗口内；更早的历史事件对当前诊断无价值。 */
export function lastEventWindow(text: string): string {
  const lines = text.split(/\r?\n/);
  const ROOT_CAUSE = /spawn failed|Error:|duplicate loader|failed to apply|plugin tree failed|unable to|rejected|refused/i;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (ROOT_CAUSE.test(lines[i])) return lines.slice(i).join('\n');
  }
  return text;
}

/**
 * 诊断场景的日志读取（排错/修复会话/诊断报告用）：
 * 先截尾部（聚焦最近状态，默认 64KB）→ 剥 ANSI → 只取最近一次关键事件窗口 → 限行数（默认 30 行）。
 * 避免把 TUI 渲染字符、历史无关错误和超长日志灌给 DSH。
 */
export function readDiagnosticLogTail(filePath: string, maxLines = 30, tailBytes = 64 * 1024): string {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const window = lastEventWindow(stripAnsi(tailText(raw, tailBytes)));
    return redact(window.split(/\r?\n/).slice(-maxLines).join('\n'));
  } catch {
    return '';
  }
}
