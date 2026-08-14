import { describe, expect, it } from 'vitest';
import { SETTINGS_EXTENSION_SCRIPT } from './settingsExtension.js';

function bracesBalanced(code: string): boolean {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && inString === null;
}

describe('SETTINGS_EXTENSION_SCRIPT（DSH 官方设置扩展）', () => {
  it('大括号/引号配平（语法防呆）', () => {
    expect(bracesBalanced(SETTINGS_EXTENSION_SCRIPT)).toBe(true);
  });

  it('锚定稳定：不依赖哈希类名，用 通用设置/General 文本定位导航', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('通用设置|General');
  });

  it('导航格与分组标题带图标（DSH 同款 16×16 描边约定）', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('viewBox="0 0 16 16"');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('stroke-linecap="round"');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("ICON('power')");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("ICON('folder')");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("ICON('bell')");
  });

  it('中英双语齐全且各自成组', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("title: '全局提示词'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("title: 'Global prompt'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("save: '保存'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("save: 'Save'");
  });

  it('全部走既有 dshShell 桥（不新增 IPC）', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('shell.getPromptSettings()');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('shell.savePromptSettings(');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('shell.listProjectInstructions()');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('shell.saveProjectInstruction(');
  });

  it('双兜底重挂载（DSH 事件流重渲染弹窗会重建）', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('MutationObserver');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('setInterval(attach, 1500)');
  });
});
