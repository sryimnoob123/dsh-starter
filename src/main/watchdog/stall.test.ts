import { describe, expect, it } from 'vitest';
import {
  ESCALATE_MS,
  freshTracker,
  markSent,
  STALL_MS,
  stallDecision,
  updateTracker,
  type StallFrame,
} from './stall.js';

const T0 = 1_000_000;

describe('updateTracker', () => {
  it('运行中任务 → running=true 且记活动时间', () => {
    const state = freshTracker(T0);
    const frame: StallFrame = { type: 'session/jobs', sessionId: 's1', jobs: [{ status: 'running' }] };
    const next = updateTracker(state, frame, T0 + 1000);
    expect(next.running).toBe(true);
    expect(next.lastActivityAt).toBe(T0 + 1000);
  });

  it('任何帧都算活动（含无 jobs 的帧）', () => {
    const state = { running: true, lastActivityAt: T0, level1Sent: true, level2Sent: false };
    const next = updateTracker(state, { type: 'session/subscribed', sessionId: 's1' }, T0 + 5000);
    expect(next.lastActivityAt).toBe(T0 + 5000);
    expect(next.running).toBe(true); // 非 jobs 帧不改变 running
  });

  it('任务终态复位 running 与提醒标记', () => {
    const state: ReturnType<typeof freshTracker> = {
      running: true,
      lastActivityAt: T0,
      level1Sent: true,
      level2Sent: true,
    };
    const next = updateTracker(state, { type: 'session/jobs', sessionId: 's1', jobs: [{ status: 'completed' }] }, T0 + 10);
    expect(next.running).toBe(false);
    expect(next.level1Sent).toBe(false);
    expect(next.level2Sent).toBe(false);
  });

  it('stopping 也算运行中（任务收尾仍可能有活动）', () => {
    const state = freshTracker(T0);
    const next = updateTracker(state, { type: 'session/jobs', sessionId: 's1', jobs: [{ status: 'stopping' }] }, T0 + 10);
    expect(next.running).toBe(true);
  });
});

describe('stallDecision', () => {
  it('无运行任务 → 永不提醒', () => {
    const state = freshTracker(T0);
    expect(stallDecision({ ...state, lastActivityAt: T0 - 100 * 60 * 1000 }, T0).kind).toBe('none');
  });

  it('空闲 < 5 分钟 → 不提醒', () => {
    const state = { running: true, lastActivityAt: T0 - (STALL_MS - 1000), level1Sent: false, level2Sent: false };
    expect(stallDecision(state, T0).kind).toBe('none');
  });

  it('空闲 ≥ 5 分钟 → 一级提醒（一次）', () => {
    const state = { running: true, lastActivityAt: T0 - STALL_MS, level1Sent: false, level2Sent: false };
    const d = stallDecision(state, T0);
    expect(d).toMatchObject({ kind: 'stalled', level: 1 });
    const marked = markSent(state, 1);
    expect(stallDecision(marked, T0 + 1000).kind).toBe('none'); // 已发过不再重复
  });

  it('一级后仍空闲满 3 分钟 → 二级升级（一次）', () => {
    const state = { running: true, lastActivityAt: T0 - (STALL_MS + ESCALATE_MS), level1Sent: true, level2Sent: false };
    const d = stallDecision(state, T0);
    expect(d).toMatchObject({ kind: 'escalate', level: 2 });
    const marked = markSent(state, 2);
    expect(stallDecision(marked, T0 + 60_000).kind).toBe('none');
  });

  it('二级升级前保持静默', () => {
    const state = { running: true, lastActivityAt: T0 - (STALL_MS + ESCALATE_MS - 1000), level1Sent: true, level2Sent: false };
    expect(stallDecision(state, T0).kind).toBe('none');
  });

  it('活动恢复后重新计时', () => {
    const state = { running: true, lastActivityAt: T0, level1Sent: false, level2Sent: false };
    const resumed = updateTracker(state, { type: 'session/subscribed', sessionId: 's1' }, T0 + 10 * 60 * 1000);
    expect(stallDecision(resumed, T0 + 10 * 60 * 1000).kind).toBe('none');
  });
});

describe('markSent', () => {
  it('只落对应级别的账', () => {
    const state = { running: true, lastActivityAt: T0, level1Sent: false, level2Sent: false };
    expect(markSent(state, 1)).toMatchObject({ level1Sent: true, level2Sent: false });
    expect(markSent({ ...state, level1Sent: true }, 2)).toMatchObject({ level1Sent: true, level2Sent: true });
  });
});
