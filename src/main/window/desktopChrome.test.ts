import { describe, expect, it } from 'vitest';
import {
  DESKTOP_CSS,
  DRAG_BAR_SCRIPT,
  FLOATING_CONTROLS_SCRIPT,
  PAGE_THEME_CSS,
  PAGE_THEME_SCRIPT,
  VIEW_TAB_SCRIPT,
} from './desktopChrome.js';

/** 大括号/引号配平（注入字符串的语法防呆） */
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

describe('desktopChrome 注入脚本（整窗外观，[D83]/[D84]/[D85]）', () => {
  it.each([
    ['FLOATING_CONTROLS_SCRIPT', FLOATING_CONTROLS_SCRIPT],
    ['DRAG_BAR_SCRIPT', DRAG_BAR_SCRIPT],
    ['PAGE_THEME_SCRIPT', PAGE_THEME_SCRIPT],
    ['VIEW_TAB_SCRIPT', VIEW_TAB_SCRIPT],
    ['DESKTOP_CSS', DESKTOP_CSS],
    ['PAGE_THEME_CSS', PAGE_THEME_CSS],
  ])('%s 语法配平', (_name, code) => {
    expect(bracesBalanced(code)).toBe(true);
  });

  it('悬浮按钮 = 检查更新 + 最小化/最大化/关闭（[D78] 更新按钮；设置入口在官方设置内，右上角无齿轮）', () => {
    expect(FLOATING_CONTROLS_SCRIPT).toContain('data-act="check-update"');
    expect(FLOATING_CONTROLS_SCRIPT).toContain('data-act="minimize"');
    expect(FLOATING_CONTROLS_SCRIPT).toContain('data-act="toggle-maximize"');
    expect(FLOATING_CONTROLS_SCRIPT).toContain('data-act="close"');
    expect(FLOATING_CONTROLS_SCRIPT).toContain('checkForUpdates');
    expect(FLOATING_CONTROLS_SCRIPT).not.toContain('open-settings');
  });

  it('拖拽条 = 原生 -webkit-app-region: drag（无 JS setPosition、无双击最大化的旧问题）', () => {
    expect(DRAG_BAR_SCRIPT).toContain('-webkit-app-region:drag');
    expect(DRAG_BAR_SCRIPT).toContain('dsh-drag-bar');
    expect(DRAG_BAR_SCRIPT).toContain('position:fixed;top:0');
    // 顶部交互元素动态标 no-drag + 抬到拖拽条之上，保持可点击
    expect(DRAG_BAR_SCRIPT).toContain('no-drag');
    expect(DRAG_BAR_SCRIPT).toContain('MutationObserver');
    expect(DRAG_BAR_SCRIPT).toContain('getBoundingClientRect');
    // 给右上角悬浮窗口按钮留位：header 标题行加右 padding，避免导出/下载按钮重叠
    expect(DRAG_BAR_SCRIPT).toContain('paddingRight');
    expect(DRAG_BAR_SCRIPT).toContain('firstElementChild');
    // 不再走 JS 拖拽（mousedown/setPosition 循环）——那是 150% 缩放下窗口漂移变大的根因
    expect(DRAG_BAR_SCRIPT).not.toContain('mousedown');
    expect(DRAG_BAR_SCRIPT).not.toContain('drag-start');
    expect(DRAG_BAR_SCRIPT).not.toContain('setPosition');
  });

  it('轨迹视图脚本：选中轨迹隐藏 composer 底部层，锚点不依赖哈希前缀', () => {
    expect(VIEW_TAB_SCRIPT).toContain('轨迹|Trajectory');
    expect(VIEW_TAB_SCRIPT).toContain('composerStack');
    expect(VIEW_TAB_SCRIPT).toContain('composerSeat');
    expect(VIEW_TAB_SCRIPT).toContain('aria-selected');
  });

  it('壳本地页 OC 排版规则带 body 前缀（inspector 表排序靠前，靠特异性赢页面样式）', () => {
    expect(PAGE_THEME_CSS).toContain('body .card{border-radius:9px');
    expect(PAGE_THEME_CSS).toContain('body h1{font-size:18px');
    expect(PAGE_THEME_CSS).toContain('body .btn{min-height:36px');
  });

  it('深浅两套桌面级变量齐全（标题栏/滚动条随主题换色）', () => {
    expect(PAGE_THEME_CSS).toContain('html[data-dsh-theme="dark"]');
    expect(PAGE_THEME_CSS).toContain('html[data-dsh-theme="light"]');
    expect(PAGE_THEME_CSS).toContain('--dsh-desktop-titlebar-bg');
    expect(PAGE_THEME_CSS).toContain('--dsh-desktop-scroll-thumb');
  });
});
