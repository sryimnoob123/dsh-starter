/**
 * FR-17.8 壳侧独立卡住看门狗（纯逻辑，可测试）。
 *
 * 边界：只依赖既有稳定接口——`/api/events.mux` 帧流（app.ts 已订阅）+ 系统通知。
 * 语义（与 FR-17.8/细化文档对齐）：
 * - 某会话有运行中任务（session/jobs 含 running）且 5 分钟无任何帧活动 → 一级提醒
 * - 一级提醒后仍无活动满 3 分钟 → 二级升级提醒；之后静默直到活动恢复或任务结束
 * - 任何帧 = 活动（含 stream 类）；任务终态重置状态
 * 看门狗独立于 DSH 主 agent 的主动性：帧停了就触发，不轮询 DSH、不发 RPC。
 */

export interface StallTrackerState {
  /** 会话是否有运行中任务 */
  running: boolean;
  /** 最近一次收到该会话帧的时间戳（ms） */
  lastActivityAt: number;
  /** 一级提醒已发 */
  level1Sent: boolean;
  /** 二级提醒已发 */
  level2Sent: boolean;
}

export const STALL_MS = 5 * 60 * 1000;
export const ESCALATE_MS = 3 * 60 * 1000;

export function freshTracker(now: number): StallTrackerState {
  return { running: false, lastActivityAt: now, level1Sent: false, level2Sent: false };
}

export interface StallFrame {
  type: string;
  sessionId?: string;
  /** session/jobs 帧的任务列表 */
  jobs?: Array<{ status: string }>;
}

const RUNNING = new Set(['running', 'stopping']);

/** 用一帧更新会话状态：有任务在跑 → 记活动并置 running；终态 → 复位 */
export function updateTracker(state: StallTrackerState, frame: StallFrame, now: number): StallTrackerState {
  const next: StallTrackerState = { ...state, lastActivityAt: now };
  if (frame.type === 'session/jobs' && Array.isArray(frame.jobs)) {
    next.running = frame.jobs.some((j) => RUNNING.has(j.status));
    if (!next.running) {
      next.level1Sent = false;
      next.level2Sent = false;
    }
  }
  return next;
}

export type StallDecision =
  | { kind: 'none' }
  | { kind: 'stalled'; level: 1; idleMs: number }
  | { kind: 'escalate'; level: 2; idleMs: number };

/**
 * 判定是否该发提醒。规则：running 且空闲 ≥ 5 分钟 → level1（一次）；
 * level1 后仍空闲 ≥ 5+3 分钟 → level2（一次）；之后静默。
 */
export function stallDecision(state: StallTrackerState, now: number): StallDecision {
  if (!state.running) return { kind: 'none' };
  const idleMs = now - state.lastActivityAt;
  if (idleMs < STALL_MS) return { kind: 'none' };
  if (state.level1Sent) {
    if (!state.level2Sent && idleMs >= STALL_MS + ESCALATE_MS) return { kind: 'escalate', level: 2, idleMs };
    return { kind: 'none' };
  }
  return { kind: 'stalled', level: 1, idleMs };
}

/** 提醒发出后落账（决定 + 状态 → 新状态） */
export function markSent(state: StallTrackerState, level: 1 | 2): StallTrackerState {
  return {
    ...state,
    level1Sent: level === 1 ? true : state.level1Sent,
    level2Sent: level === 2 ? true : state.level2Sent,
  };
}
