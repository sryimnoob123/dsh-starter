import { describe, expect, it } from 'vitest';
import { decidePort, DEFAULT_PORT, nextFreeCandidates } from './port.js';

describe('decidePort（智能端口决策，[FR-25.3]）', () => {
  it('reuses a running dsh on the remembered port', () => {
    expect(decidePort('dsh', { remembered: 3090 })).toEqual({ action: 'reuse', port: 3090 });
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

  it('uses the remembered port over the default', () => {
    expect(decidePort('free', { remembered: 5000 })).toEqual({ action: 'spawn', port: 5000 });
  });
});

describe('nextFreeCandidates', () => {
  it('starts after the given port and avoids privileged ports', () => {
    expect(nextFreeCandidates(3080)).toEqual([3081, 3082, 3083]);
    expect(nextFreeCandidates(80)).toEqual([1024, 1025, 1026]);
  });
});
