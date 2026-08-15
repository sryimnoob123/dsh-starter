import { describe, expect, it } from 'vitest';
import type { PortDecision } from './port.js';
import { decideStartup } from './startup.js';

describe('decideStartup（managed 模式启动门禁：不再复用外部服务）', () => {
  const spawn: PortDecision = { action: 'spawn', port: 3080 };
  const nextFree: PortDecision = { action: 'next-free', candidatePorts: [3081, 3082, 3083] };
  const ask: PortDecision = { action: 'ask', candidatePorts: [3081, 3082, 3083] };

  it('端口空闲但要拉起服务：Node 不合格 → node-missing 引导', () => {
    expect(decideStartup(spawn, { nodeOk: false, dshDetected: true })).toEqual({
      kind: 'guide',
      guidance: 'node-missing',
    });
  });

  it('端口空闲但要拉起服务：未检出 DSH → dsh-missing 引导（首启走安装向导）', () => {
    expect(decideStartup(spawn, { nodeOk: true, dshDetected: false })).toEqual({
      kind: 'guide',
      guidance: 'dsh-missing',
    });
  });

  it('端口被 dsh 占（next-free）：与 spawn 同门禁——Node 不合格 → node-missing', () => {
    expect(decideStartup(nextFree, { nodeOk: false, dshDetected: true })).toEqual({
      kind: 'guide',
      guidance: 'node-missing',
    });
  });

  it('端口被 dsh 占（next-free）：未检出 DSH → dsh-missing', () => {
    expect(decideStartup(nextFree, { nodeOk: true, dshDetected: false })).toEqual({
      kind: 'guide',
      guidance: 'dsh-missing',
    });
  });

  it('端口被未知程序占：环境齐全 → 询问换端口；未检出 DSH → 先 dsh-missing', () => {
    expect(decideStartup(ask, { nodeOk: true, dshDetected: true })).toEqual({ kind: 'ask' });
    expect(decideStartup(ask, { nodeOk: true, dshDetected: false })).toEqual({
      kind: 'guide',
      guidance: 'dsh-missing',
    });
  });

  it('端口空闲且环境齐全 → spawn；dsh 占用且环境齐全 → 也 spawn（端口由上层探测后决定）', () => {
    expect(decideStartup(spawn, { nodeOk: true, dshDetected: true })).toEqual({ kind: 'spawn' });
    expect(decideStartup(nextFree, { nodeOk: true, dshDetected: true })).toEqual({ kind: 'spawn' });
  });
});
