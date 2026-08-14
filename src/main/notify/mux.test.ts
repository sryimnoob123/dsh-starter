import { describe, expect, it } from 'vitest';
import { unwrapMuxEnvelope } from './mux.js';

describe('unwrapMuxEnvelope（events.mux 信封解包）', () => {
  it('server-request 信封 → 解出 payload（新协议：事件在 payload 里）', () => {
    const payload = { type: 'session/jobs', sessionId: 's1', jobs: [] };
    expect(
      unwrapMuxEnvelope({ type: 'server-request', rpcId: 'r1', method: 'session/jobs', payload }),
    ).toEqual(payload);
  });

  it('裸帧（旧协议）原样放行', () => {
    const frame = { type: 'session/jobs', sessionId: 's1' };
    expect(unwrapMuxEnvelope(frame)).toEqual(frame);
  });

  it('非对象/异常输入原样返回', () => {
    expect(unwrapMuxEnvelope(null)).toBeNull();
    expect(unwrapMuxEnvelope('x')).toBe('x');
    expect(unwrapMuxEnvelope(42)).toBe(42);
  });

  it('server-request 但 payload 缺失 → 原样返回（防误丢）', () => {
    const envelope = { type: 'server-request', rpcId: 'r1' };
    expect(unwrapMuxEnvelope(envelope)).toEqual(envelope);
  });
});
