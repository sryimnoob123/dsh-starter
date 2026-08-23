import { describe, expect, it } from 'vitest';
import {
  addDisabledEntry,
  addInsertEntry,
  extractInsertBlock,
  hasDisabledEntry,
  hasInsertBlock,
  removeDisabledEntry,
  removeInsertBlock,
} from './profilePatch.js';

const DSH_DEFAULT_PATCH = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
].join('\n');

describe('addInsertEntry（幂等追加 insert 块）', () => {
  it('把 DSH 默认的空数组 [] 替换成 insert 条目', () => {
    const out = addInsertEntry(DSH_DEFAULT_PATCH, 'win-terminal-inspector', './plugins/dsh-win-terminal-inspector/index.js');
    expect(out).toContain('id: win-terminal-inspector');
    expect(out).toContain('name: ./plugins/dsh-win-terminal-inspector/index.js');
    expect(out).not.toContain('[]');
    expect(out).toContain('applied after every bundle layer');
  });

  it('已存在该 id 时原样返回，不重复、不覆盖', () => {
    const withEntry = addInsertEntry(DSH_DEFAULT_PATCH, 'x', './plugins/x/index.js');
    const again = addInsertEntry(withEntry, 'x', './plugins/x/index.js');
    expect(again).toBe(withEntry);
  });

  it('已有其他条目时只在末尾追加，不动已有内容', () => {
    const existing = ['- insert:', '    - id: someone-else', '      name: ./plugins/other/index.js'].join('\n');
    const out = addInsertEntry(existing, 'x', './plugins/x/index.js');
    expect(out.indexOf('someone-else')).toBeLessThan(out.indexOf('x'));
    expect(out.match(/id: x/g)).toHaveLength(1);
  });

  it('空字符串（patch 不存在）也产出合法单条目', () => {
    const out = addInsertEntry('', 'x', './plugins/x/index.js');
    expect(out.trim()).toContain('- insert:');
    expect(out.trim()).toContain('id: x');
  });

  it('真实形态（注释头 + 多块）下追加不粘连、可解析', () => {
    const existing = [
      '# 注释头',
      '- id: web-runtime',
      '  config:',
      '    openBrowser: false',
      '- id: a',
      '  disabled: true',
    ].join('\n');
    const out = addInsertEntry(existing, 'b', './plugins/b/index.js');
    // 块间换行保留：不粘连
    expect(out).not.toContain('false- insert:');
    expect(out).not.toContain('disabled: true- insert:');
    expect(out.split('\n').filter((l) => l.startsWith('- ')).length).toBeGreaterThanOrEqual(3);
  });

  it('注释里的 insert: 字样不误判为已存在', () => {
    const existing = ['# 示例：- insert:', '# - id: demo', '- id: other'].join('\n');
    expect(hasInsertBlock(existing, 'demo')).toBe(false);
    const out = addInsertEntry(existing, 'real', './plugins/real/index.js');
    expect(out).toContain('- insert:');
    expect(out).toContain('id: real');
  });
});

describe('addDisabledEntry / removeDisabledEntry（开关条目）', () => {
  it('追加 disabled 条目；再删 → 移除；幂等', () => {
    const withDisabled = addDisabledEntry('', 'better-sidebar');
    expect(withDisabled).toContain('- id: better-sidebar');
    expect(withDisabled).toContain('disabled: true');
    expect(addDisabledEntry(withDisabled, 'better-sidebar')).toBe(withDisabled);

    const without = removeDisabledEntry(withDisabled, 'better-sidebar');
    expect(without).not.toContain('disabled: true');
    expect(removeDisabledEntry(without, 'better-sidebar')).toBe(without);
  });

  it('块内还有 config/insert 时只去掉 disabled 行，保留块', () => {
    const existing = ['- id: web-runtime', '  config:', '    openBrowser: false', '  disabled: true'].join('\n');
    const out = removeDisabledEntry(existing, 'web-runtime');
    expect(out).toContain('openBrowser: false');
    expect(out).not.toContain('disabled: true');
  });
});

describe('removeInsertBlock（移除语义）', () => {
  it('删除该 entry 的 insert 块 + 标 disabled 双保险，保留其他块', () => {
    const existing = [
      '- insert:',
      '    - id: a',
      '      name: ./plugins/a/index.js',
      '- insert:',
      '    - id: b',
      '      name: ./plugins/b/index.js',
    ].join('\n');
    const out = removeInsertBlock(existing, 'a');
    // a 的 insert 块被删（不再加载），但 a 作为 disabled 条目保留（双保险）
    expect(out).not.toContain('name: ./plugins/a/index.js');
    expect(out).toContain('id: a');
    expect(out).toContain('disabled: true');
    expect(out).toContain('id: b');
  });
});

describe('hasInsertBlock / hasDisabledEntry / extractInsertBlock（查询）', () => {
  it('hasInsertBlock 按 entry id 判断', () => {
    const text = ['- insert:', '    - id: a', '      name: x'].join('\n');
    expect(hasInsertBlock(text, 'a')).toBe(true);
    expect(hasInsertBlock(text, 'b')).toBe(false);
  });

  it('hasDisabledEntry 按 entry id 判断', () => {
    const text = ['- id: a', '  disabled: true'].join('\n');
    expect(hasDisabledEntry(text, 'a')).toBe(true);
    expect(hasDisabledEntry(text, 'b')).toBe(false);
  });

  it('extractInsertBlock 提取该 entry 的 insert 块（含 - insert: 开头）', () => {
    const text = [
      '- insert:',
      '    - id: a',
      '      name: ./plugins/a/index.js',
      '- id: other',
      '  config: {}',
    ].join('\n');
    const block = extractInsertBlock(text, 'a');
    expect(block).toContain('- insert:');
    expect(block).toContain('id: a');
    expect(block).not.toContain('other');
    expect(extractInsertBlock(text, 'ghost')).toBeNull();
  });
});
