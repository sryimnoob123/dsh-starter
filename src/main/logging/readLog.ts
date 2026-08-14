import { readFileSync } from 'node:fs';
import { redact } from './redact.js';

/**
 * 日志查看（logs.html 的 readLog(kind) 与托盘"查看日志"共用）：
 * 只返回文件尾部（默认 256K 字符，防日志过大拖垮页面），并复用 redact 脱敏。
 */

/** 纯函数：截取文本尾部 maxBytes 字符，并从下一行行首对齐（不返回半行） */
export function tailText(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (text.length <= maxBytes) return text;
  const tail = text.slice(text.length - maxBytes);
  const nl = tail.indexOf('\n');
  return nl === -1 ? tail : tail.slice(nl + 1);
}

export function readLogTail(filePath: string, maxBytes = 256 * 1024): string {
  try {
    return redact(tailText(readFileSync(filePath, 'utf8'), maxBytes));
  } catch {
    // 文件不存在/读失败：返回空串，页面显示"暂无日志"
    return '';
  }
}
