import { describe, expect, it } from 'vitest';
import {
  BRIDGE_API,
  parseConnectionConfig,
  parseInstallPhase,
  parseLogKind,
  parsePort,
  parseProjectInstructionInput,
  parsePromptSettingsInput,
  parseWindowAction,
} from './contract.js';

describe('BRIDGE_API 方法面（页面契约，改名 = 破坏外包页面，[D79] 外包包 §2）', () => {
  it('锁定 22 个方法名', () => {
    expect(Object.keys(BRIDGE_API).sort()).toEqual([
      'choosePort',
      'clearNotifications',
      'discoverModels',
      'getPromptSettings',
      'goInstall',
      'listProjectInstructions',
      'onProgress',
      'onServiceStatus',
      'openLogs',
      'openMain',
      'openPromptSettings',
      'pickDir',
      'quit',
      'readLog',
      'readNotifications',
      'retry',
      'saveConnection',
      'saveProjectInstruction',
      'savePromptSettings',
      'startInstall',
      'testConnection',
      'windowControl',
    ]);
  });

  it('所有通道名互不重复', () => {
    const channels = Object.values(BRIDGE_API);
    expect(new Set(channels).size).toBe(channels.length);
  });
});

describe('parsePort', () => {
  it.each([3080, 1024, 65535])('接受合法端口 %i', (p) => {
    expect(parsePort(p)).toBe(p);
  });

  it.each([0, 1023, 65536, 3.5, NaN, Infinity, -1, '3080', null, undefined])(
    '拒绝非法端口 %o',
    (v) => {
      expect(parsePort(v)).toBeNull();
    },
  );
});

describe('parseLogKind', () => {
  it('接受 shell / service', () => {
    expect(parseLogKind('shell')).toBe('shell');
    expect(parseLogKind('service')).toBe('service');
  });

  it.each(['other', 1, null, undefined, {}])('拒绝非法类型 %o', (v) => {
    expect(parseLogKind(v)).toBeNull();
  });
});

describe('parseConnectionConfig', () => {
  it('接受合法配置并去除首尾空白', () => {
    expect(
      parseConnectionConfig({ baseUrl: ' https://api.example.com/v1 ', apiKey: ' sk-x ', model: ' deepseek-chat ' }),
    ).toEqual({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'deepseek-chat' });
  });

  it('接受可选 models 列表（自动获取的全部模型登记用）', () => {
    expect(
      parseConnectionConfig({ baseUrl: 'https://x', apiKey: 'k', model: 'm1', models: ['m1', 'm2', '', 'm2', 7] }),
    ).toEqual({ baseUrl: 'https://x', apiKey: 'k', model: 'm1', models: ['m1', 'm2'] });
  });

  it('models 全非法时丢弃该字段', () => {
    const cfg = parseConnectionConfig({ baseUrl: 'https://x', apiKey: 'k', model: 'm1', models: ['', 3] });
    expect(cfg?.models).toBeUndefined();
  });

  it('允许 http://（本机端点）', () => {
    expect(parseConnectionConfig({ baseUrl: 'http://127.0.0.1:3000/v1', apiKey: 'k', model: 'm' })).not.toBeNull();
  });

  it.each([
    [{ baseUrl: 'ftp://x', apiKey: 'k', model: 'm' }],
    [{ baseUrl: 'api.example.com', apiKey: 'k', model: 'm' }],
    [{ baseUrl: 'https://x', apiKey: '', model: 'm' }],
    [{ baseUrl: 'https://x', apiKey: 'k', model: '' }],
    [{ baseUrl: 'https://x', apiKey: 'k' }],
    [{ baseUrl: 1, apiKey: 'k', model: 'm' }],
    [null],
    ['https://x'],
  ])('拒绝非法配置 %o', (v) => {
    expect(parseConnectionConfig(v)).toBeNull();
  });
});

describe('parseInstallPhase', () => {
  it.each(['download', 'install', 'configure', 'launch', 'done', 'error'])('接受阶段 %s', (p) => {
    expect(parseInstallPhase(p)).toBe(p);
  });

  it.each(['ask', 'detect', '', 1, null])('拒绝非法阶段 %o', (v) => {
    expect(parseInstallPhase(v)).toBeNull();
  });
});

describe('parseWindowAction（自绘标题栏按钮动作）', () => {
  it.each(['minimize', 'toggle-maximize', 'close'])('接受动作 %s', (a) => {
    expect(parseWindowAction(a)).toBe(a);
  });

  it.each(['maximize', 'quit', 'resize', '', 1, null])('拒绝非法动作 %o', (v) => {
    expect(parseWindowAction(v)).toBeNull();
  });
});

describe('parsePromptSettingsInput（设置页保存载荷，[FR-16]/[FR-4.3]）', () => {
  const valid = {
    includeHarnessIdentity: false,
    persona: 'hi',
    globalPrompt: '# rules',
    restart: true,
  };

  it('接受完整载荷并透传通知开关', () => {
    expect(parsePromptSettingsInput({ ...valid, notifyResult: false })).toEqual({
      ...valid,
      notifyResult: false,
    });
  });

  it('notifyResult 可省略（旧页面向后兼容）', () => {
    expect(parsePromptSettingsInput(valid)).toEqual(valid);
  });

  it('接受可选 uiTheme（跟随系统/深色/浅色三态）', () => {
    expect(parsePromptSettingsInput({ ...valid, uiTheme: 'light' })).toEqual({ ...valid, uiTheme: 'light' });
    expect(parsePromptSettingsInput({ ...valid, uiTheme: 'dark' })).toEqual({ ...valid, uiTheme: 'dark' });
    expect(parsePromptSettingsInput({ ...valid, uiTheme: 'system' })).toEqual({ ...valid, uiTheme: 'system' });
  });

  it.each([
    [null],
    [{ ...valid, includeHarnessIdentity: 'no' }],
    [{ ...valid, persona: 7 }],
    [{ ...valid, persona: 'x'.repeat(20_001) }],
    [{ ...valid, globalPrompt: 5 }],
    [{ ...valid, globalPrompt: 'x'.repeat(1_000_001) }],
    [{ ...valid, restart: 1 }],
    [{ ...valid, notifyResult: 'yes' }],
    [{ ...valid, uiTheme: 'blue' }],
    [{ ...valid, uiTheme: 1 }],
  ])('拒绝非法载荷 %o', (v) => {
    expect(parsePromptSettingsInput(v)).toBeNull();
  });
});

describe('parseProjectInstructionInput（项目级指令保存载荷，[FR-16.7] P1）', () => {
  it('接受合法载荷并去空白 workspaceId', () => {
    expect(parseProjectInstructionInput({ workspaceId: ' w1 ', content: '# rules' })).toEqual({
      workspaceId: 'w1',
      content: '# rules',
    });
  });

  it.each([
    [null],
    [{ workspaceId: '', content: 'x' }],
    [{ workspaceId: 'w'.repeat(201), content: 'x' }],
    [{ workspaceId: 42, content: 'x' }],
    [{ workspaceId: 'w1', content: 7 }],
    [{ workspaceId: 'w1', content: 'x'.repeat(1_000_001) }],
    [{ workspaceId: 'w1' }],
  ])('拒绝非法载荷 %o', (v) => {
    expect(parseProjectInstructionInput(v)).toBeNull();
  });
});
