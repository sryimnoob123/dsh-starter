import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendNotificationEntry,
  clearNotificationHistory,
  MAX_ENTRIES,
  notificationsFile,
  parseNotificationLine,
  readNotificationHistory,
} from './history.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-notif-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseNotificationLine', () => {
  it('解析合法行', () => {
    expect(parseNotificationLine('{"time":123,"title":"t","body":"b"}')).toEqual({
      time: 123,
      title: 't',
      body: 'b',
    });
  });

  it('容忍首行 BOM（外部工具写入的 UTF-8 BOM）', () => {
    expect(parseNotificationLine('\uFEFF{"time":123,"title":"t","body":"b"}')).toEqual({
      time: 123,
      title: 't',
      body: 'b',
    });
  });

  it.each(['not-json', '{"time":"x"}', '{"time":1,"title":2,"body":"b"}', '[]', 'null', ''])(
    '坏行返回 null（%s）',
    (v) => {
      expect(parseNotificationLine(v)).toBeNull();
    },
  );
});

describe('append / read / clear', () => {
  it('追加后按新→旧读取', () => {
    appendNotificationEntry(dir, { time: 1, title: 'a', body: '1' });
    appendNotificationEntry(dir, { time: 2, title: 'b', body: '2' });
    expect(readNotificationHistory(dir)).toEqual([
      { time: 2, title: 'b', body: '2' },
      { time: 1, title: 'a', body: '1' },
    ]);
  });

  it('无文件时读取返回空数组，不报错', () => {
    expect(readNotificationHistory(dir)).toEqual([]);
  });

  it('清空后读取为空', () => {
    appendNotificationEntry(dir, { time: 1, title: 'a', body: '1' });
    clearNotificationHistory(dir);
    expect(readNotificationHistory(dir)).toEqual([]);
  });

  it('超过上限只保留最新 MAX_ENTRIES 条', () => {
    for (let i = 1; i <= MAX_ENTRIES + 20; i++) {
      appendNotificationEntry(dir, { time: i, title: `t${i}`, body: 'b' });
    }
    const history = readNotificationHistory(dir, 10_000);
    expect(history.length).toBe(MAX_ENTRIES);
    expect(history[0].time).toBe(MAX_ENTRIES + 20); // 最新在前
  });

  it('坏行不影响其余读取', () => {
    appendNotificationEntry(dir, { time: 1, title: 'a', body: '1' });
    appendNotificationEntry(dir, { time: 2, title: 'b', body: '2' });
    // 手动塞入坏行
    appendFileSync(notificationsFile(dir), 'broken-line\n', 'utf8');
    const history = readNotificationHistory(dir);
    expect(history).toEqual([
      { time: 2, title: 'b', body: '2' },
      { time: 1, title: 'a', body: '1' },
    ]);
  });
});
