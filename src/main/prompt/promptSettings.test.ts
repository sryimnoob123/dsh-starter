import { describe, expect, it } from 'vitest';
import {
  buildDesktopPatchYaml,
  defaultPromptUserConfig,
  desktopDshHome,
  globalAgentsPath,
  isPromptCustomized,
  normalizePromptConfig,
  WEB_BASE_PERSONA,
} from './promptSettings.js';

describe('normalizePromptConfig', () => {
  it('非对象/脏数据回默认', () => {
    const def = defaultPromptUserConfig();
    for (const raw of [undefined, null, 'x', 42, true, []]) {
      expect(normalizePromptConfig(raw)).toEqual(def);
    }
  });

  it('字段类型不对时单项回默认', () => {
    expect(normalizePromptConfig({ includeHarnessIdentity: 'yes', persona: 7 })).toEqual(
      defaultPromptUserConfig(),
    );
    expect(normalizePromptConfig({ includeHarnessIdentity: true, persona: 'hi' })).toEqual({
      includeHarnessIdentity: true,
      persona: 'hi',
    });
  });
});

describe('isPromptCustomized', () => {
  it('与 web 基线一致 = 未定制（含 persona 首尾空白差异）', () => {
    expect(isPromptCustomized(defaultPromptUserConfig())).toBe(false);
    expect(
      isPromptCustomized({ includeHarnessIdentity: false, persona: `  ${WEB_BASE_PERSONA}\n` }),
    ).toBe(false);
  });

  it('身份开关或 persona 任一偏离基线 = 已定制', () => {
    expect(isPromptCustomized({ includeHarnessIdentity: true, persona: WEB_BASE_PERSONA })).toBe(true);
    expect(isPromptCustomized({ includeHarnessIdentity: false, persona: 'Be terse.' })).toBe(true);
  });
});

describe('buildDesktopPatchYaml', () => {
  it('基线一致时只含 agent-instructions 行', () => {
    expect(buildDesktopPatchYaml(defaultPromptUserConfig())).toBe(
      '- id: agent-instructions\n  disabled: false\n',
    );
  });

  it('定制后整行重述 system-prompt 的 config（patch 整体替换语义）', () => {
    const yaml = buildDesktopPatchYaml({ includeHarnessIdentity: true, persona: WEB_BASE_PERSONA });
    expect(yaml).toContain('- id: system-prompt');
    expect(yaml).toContain('    includeHarnessIdentity: true');
    expect(yaml).toContain('    includeRuntimeContext: false');
    expect(yaml).toContain(`      ${WEB_BASE_PERSONA}`);
  });

  it('空 persona 写空串（DSH 渲染时删除该段）', () => {
    const yaml = buildDesktopPatchYaml({ includeHarnessIdentity: false, persona: '   ' });
    expect(yaml).toContain("    persona: ''");
    expect(yaml).not.toContain('persona: |-');
  });

  it('多行 persona 用块标量逐行缩进，特殊字符不受影响', () => {
    const yaml = buildDesktopPatchYaml({
      includeHarnessIdentity: false,
      persona: '第一行：{{model}}\n# 不是注释\n 缩进行 {curly} : colon',
    });
    const lines = yaml.split('\n');
    expect(lines).toContain('    persona: |-');
    expect(lines).toContain('      第一行：{{model}}');
    expect(lines).toContain('      # 不是注释');
    expect(lines).toContain('       缩进行 {curly} : colon');
  });

  it('\\r\\n 与 \\r 统一成 \\n，末尾不留空行', () => {
    const yaml = buildDesktopPatchYaml({
      includeHarnessIdentity: false,
      persona: 'a\r\nb\rc\r\n',
    });
    const lines = yaml.split('\n');
    const idx = lines.indexOf('    persona: |-');
    // 内容行 = a/b/c 三行；块标量 |- 会把末尾多余换行剥掉，不留空行
    expect(lines.slice(idx + 1, idx + 4)).toEqual(['      a', '      b', '      c']);
    expect(lines[idx + 4]).toBe('');
  });
});

describe('路径', () => {
  it('desktopDshHome = userData/dsh-home（与 spawn env 一致，[D80]）', () => {
    expect(desktopDshHome('C:\\Users\\x\\AppData\\Roaming\\deepseekharness')).toBe(
      'C:\\Users\\x\\AppData\\Roaming\\deepseekharness\\dsh-home',
    );
  });

  it('globalAgentsPath = <dshHome>/AGENTS.md（[FR-16.7]）', () => {
    const p = globalAgentsPath('/data/user');
    expect(p.endsWith('AGENTS.md')).toBe(true);
    expect(p).toContain('dsh-home');
  });
});
