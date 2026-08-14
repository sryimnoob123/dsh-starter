import { describe, expect, it } from 'vitest';
import type { PortDecision } from './port.js';
import { decideStartup } from './startup.js';

describe('decideStartup（启动门禁：复用外部服务优先于本地检测）', () => {
  const reuse: PortDecision = { action: 'reuse', port: 3080 };
  const spawn: PortDecision = { action: 'spawn', port: 3080 };
  const ask: PortDecision = { action: 'ask', candidatePorts: [3081, 3082, 3083] };

  it('探测到 dsh 服务 → 复用，即使本机没检出 DSH/Node（外部服务不需要这些）', () => {
    expect(decideStartup(reuse, { nodeOk: false, dshDetected: false })).toEqual({ kind: 'reuse' });
  });

  it('探测到 dsh 服务且环境齐全 → 复用', () => {
    expect(decideStartup(reuse, { nodeOk: true, dshDetected: true })).toEqual({ kind: 'reuse' });
  });

  it('端口空闲但要拉起服务：Node 不合格 → node-missing 引导', () => {
    expect(decideStartup(spawn, { nodeOk: false, dshDetected: true })).toEqual({
      kind: 'guide',
      guidance: 'node-missing',
    });
  });

  it('端口空闲但要拉起服务：未检出 DSH → dsh-missing 引导（打包版首启走安装向导）', () => {
    expect(decideStartup(spawn, { nodeOk: true, dshDetected: false })).toEqual({
      kind: 'guide',
      guidance: 'dsh-missing',
    });
  });

  it('端口被占：环境齐全 → 询问换端口；未检出 DSH → 先 dsh-missing（换端口也得有 DSH 才能起）', () => {
    expect(decideStartup(ask, { nodeOk: true, dshDetected: true })).toEqual({ kind: 'ask' });
    expect(decideStartup(ask, { nodeOk: true, dshDetected: false })).toEqual({
      kind: 'guide',
      guidance: 'dsh-missing',
    });
  });

  it('端口空闲且环境齐全 → spawn', () => {
    expect(decideStartup(spawn, { nodeOk: true, dshDetected: true })).toEqual({ kind: 'spawn' });
  });
});
