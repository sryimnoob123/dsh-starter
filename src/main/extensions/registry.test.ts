import { describe, expect, it } from 'vitest';
import { Registry } from './registry.js';

interface TrayItem extends Record<string, unknown> {
  id: string;
  title: string;
  order?: number;
}

describe('Registry（壳扩展注册中心，[FR-6.2]）', () => {
  it('registers and lists items sorted by order (default 0)', () => {
    const reg = new Registry<TrayItem>();
    reg.register({ id: 'quit', title: '退出', order: 40 });
    reg.register({ id: 'open', title: '打开窗口', order: 10 });
    reg.register({ id: 'logs', title: '查看日志' });
    expect(reg.list().map((i) => i.id)).toEqual(['logs', 'open', 'quit']);
  });

  it('rejects duplicate ids', () => {
    const reg = new Registry<TrayItem>();
    reg.register({ id: 'open', title: '打开窗口' });
    expect(() => reg.register({ id: 'open', title: 'again' })).toThrow(/duplicate/);
  });

  it('gets and removes items', () => {
    const reg = new Registry<TrayItem>();
    reg.register({ id: 'open', title: '打开窗口' });
    expect(reg.get('open')?.title).toBe('打开窗口');
    expect(reg.remove('open')).toBe(true);
    expect(reg.get('open')).toBeUndefined();
    expect(reg.remove('open')).toBe(false);
  });

  it('built-in items also go through the registry (self-evident extensibility)', () => {
    const reg = new Registry<TrayItem>();
    for (const item of [
      { id: 'open', title: '打开窗口', order: 10 },
      { id: 'stop', title: '停止服务', order: 20 },
      { id: 'logs', title: '查看日志', order: 30 },
      { id: 'quit', title: '退出', order: 40 },
    ]) {
      reg.register(item);
    }
    expect(reg.list()).toHaveLength(4);
  });
});
