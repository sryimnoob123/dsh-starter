import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * 通知历史（[D31] 候选"通知历史中心"）：所有壳通知落盘 JSONL，托盘可查看/清空。
 * 纯 Node 文件读写，与 DSH 无交互。上限 500 条（超出重写保留最新）。
 */

export interface NotificationEntry {
  /** 毫秒时间戳 */
  time: number;
  title: string;
  body: string;
}

export const MAX_ENTRIES = 500;

export function notificationsFile(userDataDir: string): string {
  return join(userDataDir, 'notifications.jsonl');
}

/** 解析单行；坏行返回 null（历史里个别损坏不影响整体展示） */
export function parseNotificationLine(line: string): NotificationEntry | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.time !== 'number' || typeof obj.title !== 'string' || typeof obj.body !== 'string') {
      return null;
    }
    return { time: obj.time, title: obj.title, body: obj.body };
  } catch {
    return null;
  }
}

/** 追加一条（自动建目录；超上限时重写保留最新 MAX_ENTRIES 条） */
export function appendNotificationEntry(userDataDir: string, entry: NotificationEntry): void {
  const file = notificationsFile(userDataDir);
  mkdirSync(dirname(file), { recursive: true });
  const line = JSON.stringify(entry);
  if (!existsSync(file)) {
    appendFileSync(file, line + '\n', 'utf8');
    return;
  }
  const existing = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  if (existing.length >= MAX_ENTRIES) {
    const kept = [...existing.slice(existing.length - (MAX_ENTRIES - 1)), line];
    writeFileSync(file, kept.join('\n') + '\n', 'utf8');
    return;
  }
  appendFileSync(file, line + '\n', 'utf8');
}

/** 读取历史（新→旧）；坏行跳过；max 截断 */
export function readNotificationHistory(userDataDir: string, max = MAX_ENTRIES): NotificationEntry[] {
  const file = notificationsFile(userDataDir);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const entries: NotificationEntry[] = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < max; i--) {
    if (!lines[i]) continue;
    const entry = parseNotificationLine(lines[i]);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** 清空历史 */
export function clearNotificationHistory(userDataDir: string): void {
  const file = notificationsFile(userDataDir);
  try {
    writeFileSync(file, '', 'utf8');
  } catch {
    // 文件不存在或不可写：清空失败等于已经为空
  }
}
