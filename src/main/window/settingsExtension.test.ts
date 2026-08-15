import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_EXTENSION_SCRIPT } from './settingsExtension.js';
import { WEB_BASE_PERSONA } from '../prompt/promptSettings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  it('不占用官方设置的用量统计（用量统计是独立托盘页 usage.html，非设置内卡片）', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).not.toContain('dsh-gp-usage-nav');
    expect(SETTINGS_EXTENSION_SCRIPT).not.toContain('dsh-gp-usage-section');
  });

  it('生效状态徽标：壳管模式（🟢）/ 外部模式（🔴）+ 双语', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('dsh-gp-mode');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("modeManaged: '壳管模式'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("modeManaged: 'Shell-managed'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("modeReuse: '外部模式'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('state.mode === \'managed\'');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('🟢');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('🔴');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("editingPath: '正在编辑：'");
    expect(SETTINGS_EXTENSION_SCRIPT).toContain("editingPath: 'Editing: '");
  });

  it('双兜底重挂载（DSH 事件流重渲染弹窗会重建）', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('MutationObserver');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('setInterval(attach, 1500)');
  });

  it('面板挂进 .content 并自身滚动（回归：挂 .panel 是 overflow:hidden 定高会裁掉内容、无法上下滑动）', () => {
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('content.appendChild(section)');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('content.lastElementChild');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('overflow-y:auto');
    expect(SETTINGS_EXTENSION_SCRIPT).toContain('flex:1 1 auto');
  });

  it('默认 persona 与规范串一致（评审 M3 漂移锁：面板/独立页/主进程三处同源）', () => {
    // 面板脚本内联的默认 persona 必须等于 promptSettings.ts 的规范串
    expect(SETTINGS_EXTENSION_SCRIPT).toContain(WEB_BASE_PERSONA);
    // 独立设置页同样引用规范串（页面是独立文件，读源码断言）
    const page = readFileSync(join(__dirname, '..', 'pages', 'prompt-settings.html'), 'utf8');
    expect(page).toContain(WEB_BASE_PERSONA);
  });
});
