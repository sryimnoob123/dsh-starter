import { describe, expect, it } from 'vitest';
import { describeShortcutRegistration, GLOBAL_TOGGLE_SHORTCUT, matchShortcut } from './shortcuts.js';

describe('matchShortcut（应用内快捷键判定）', () => {
  it('Ctrl+Shift+C → compact', () => {
    expect(matchShortcut({ key: 'C', control: true, shift: true })).toBe('compact');
  });
  it('Meta+Shift+F → repair（Mac Command）', () => {
    expect(matchShortcut({ key: 'f', meta: true, shift: true })).toBe('repair');
  });
  it('Ctrl+Shift+B → backup；Ctrl+Shift+L → logs', () => {
    expect(matchShortcut({ key: 'b', control: true, shift: true })).toBe('backup');
    expect(matchShortcut({ key: 'l', control: true, shift: true })).toBe('logs');
  });
  it('纯 Ctrl（无 Shift）不响应——不抢 DSH 页面自身快捷键', () => {
    expect(matchShortcut({ key: 'c', control: true })).toBeNull();
  });
  it('Alt 组合不响应（避免与系统键冲突）', () => {
    expect(matchShortcut({ key: 'c', control: true, shift: true, alt: true })).toBeNull();
  });
  it('非字母键/无输入不响应', () => {
    expect(matchShortcut({ key: 'F5', control: true, shift: true })).toBeNull();
    expect(matchShortcut(null as never)).toBeNull();
    expect(matchShortcut({})).toBeNull();
  });
});

describe('全局呼出键', () => {
  it('固定为 CommandOrControl+Shift+Space（跨平台）', () => {
    expect(GLOBAL_TOGGLE_SHORTCUT).toBe('CommandOrControl+Shift+Space');
  });
  it('注册结果描述', () => {
    expect(describeShortcutRegistration(true, 'CommandOrControl+Shift+Space')).toContain('registered');
    expect(describeShortcutRegistration(false, 'x')).toContain('failed');
  });
});
