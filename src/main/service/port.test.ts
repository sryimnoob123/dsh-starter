import { describe, expect, it } from 'vitest';
import { decidePort, DEFAULT_PORT, nextFreeCandidates } from './port.js';

describe('decidePort（智能端口决策，[FR-25.3] / managed 模式）', () => {
  it('dsh 占用 → 自动换空闲端口（不弹窗），候选从被占端口之后开始', () => {
    expect(decidePort('dsh', { remembered: 3090 })).toEqual({
      action: 'next-free',
      candidatePorts: [3091, 3092, 3093],
    });
  });

  it('dsh 占用默认端口 → 候选 3081/3082/3083', () => {
    expect(decidePort('dsh')).toEqual({ action: 'next-free', candidatePorts: [3081, 3082, 3083] });
  });

  it('spawns on the default port when nothing is remembered and port is free', () => {
    expect(decidePort('free')).toEqual({ action: 'spawn', port: DEFAULT_PORT });
    expect(DEFAULT_PORT).toBe(3080);
  });

  it('asks the user when a foreign service occupies the port, with candidate ports', () => {
    const decision = decidePort('occupied', { remembered: 3080 });
    expect(decision.action).toBe('ask');
    if (decision.action !== 'ask') throw new Error('expected ask');
    expect(decision.candidatePorts).toEqual([3081, 3082, 3083]);
  });

  it('uses the remembered port over the default when free', () => {
    expect(decidePort('free', { remembered: 5000 })).toEqual({ action: 'spawn', port: 5000 });
  });
});

describe('nextFreeCandidates', () => {
  it('starts after the given port and avoids privileged ports', () => {
    expect(nextFreeCandidates(3080)).toEqual([3081, 3082, 3083]);
    expect(nextFreeCandidates(80)).toEqual([1024, 1025, 1026]);
  });
});
