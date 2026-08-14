import { describe, expect, it } from 'vitest';
import { CODEX_SKIN_CSS } from './codexSkin.js';

/** 花括号配平（注入 CSS 若有语法错误会被整体丢弃，配平是最基础的防呆） */
function bracesBalanced(css: string): boolean {
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

describe('CODEX_SKIN_CSS（OC 真品 token 覆写表）', () => {
  it('花括号配平', () => {
    expect(bracesBalanced(CODEX_SKIN_CSS)).toBe(true);
  });

  it('深浅两个作用域都在，桌面级变量挂在 html:has() 供标题栏读取（标题框随主题换色）', () => {
    expect(CODEX_SKIN_CSS).toContain('body[data-ds-dark-theme][data-ds-dark-theme]');
    expect(CODEX_SKIN_CSS).toContain('body:not([data-ds-dark-theme]):not([data-ds-dark-theme])');
    expect(CODEX_SKIN_CSS).toContain('html:has(body[data-ds-dark-theme][data-ds-dark-theme])');
    expect(CODEX_SKIN_CSS).toContain('html:has(body:not([data-ds-dark-theme]):not([data-ds-dark-theme]))');
    expect(CODEX_SKIN_CSS).toContain('--dsh-desktop-titlebar-bg');
    expect(CODEX_SKIN_CSS).toContain('--dsh-desktop-scroll-thumb');
  });

  it('OC 关键 token 逐值锁定（design-system.css 原值）', () => {
    expect(CODEX_SKIN_CSS).toContain('--dsw-alias-bg-base:oklch(0.16 0.01 30)');
    expect(CODEX_SKIN_CSS).toContain('--dsw-alias-brand-primary:oklch(0.77 0.17 85)');
    expect(CODEX_SKIN_CSS).toContain('--dsw-alias-bg-base:oklch(0.97 0.02 85)');
    expect(CODEX_SKIN_CSS).toContain('--dsw-alias-brand-primary:oklch(0.65 0.2 55)');
  });

  it('不残留冷蓝：deepseek/blue 系全量映射为琥珀系（无 rgb 蓝）', () => {
    const blueRgb = /rgb\(\s*(5\d|6\d|7\d|8\d|9\d|1\d\d),\s*(1[0-8]\d|9\d),\s*2[0-5]\d\s*\)/;
    expect(CODEX_SKIN_CSS).not.toMatch(blueRgb);
  });
});
