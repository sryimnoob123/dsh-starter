import { describe, expect, it } from 'vitest';
import {
  decideRenderGone,
  MAX_RENDER_GONE_PER_WINDOW,
  RENDER_GONE_WINDOW_MS,
  STATUS_BREAKPOINT,
  type RenderGoneState,
} from './renderGone.js';

describe('decideRenderGone（渲染进程崩溃判定，缺口 1）', () => {
  it('首次普通崩溃 → reload', () => {
    const { decision, nextState } = decideRenderGone(
      { crashes: 0, lastCrashAt: 0 },
      { reason: 'oom', exitCode: 3 },
      1000,
    );
    expect(decision).toEqual({ kind: 'reload' });
    expect(nextState).toEqual({ crashes: 1, lastCrashAt: 1000 });
  });

  it('2 分钟内 3 次崩溃 → give-up（停手不刷屏）', () => {
    let state: RenderGoneState = { crashes: 0, lastCrashAt: 0 };
    let decision;
    for (let i = 0; i < MAX_RENDER_GONE_PER_WINDOW; i += 1) {
      ({ decision, nextState: state } = decideRenderGone(state, { reason: 'crash', exitCode: 1 }, 1000 + i));
    }
    expect(decision).toEqual({ kind: 'reload' });
    expect(state.crashes).toBe(3);
    // 第 4 次：窗口内已满 → give-up
    const fourth = decideRenderGone(state, { reason: 'crash', exitCode: 1 }, 1000 + 10);
    expect(fourth.decision).toEqual({ kind: 'give-up' });
  });

  it('窗口滑动：距上次崩溃超过 2 分钟 → 计数重置，再次 reload', () => {
    const state: RenderGoneState = { crashes: 2, lastCrashAt: 1000 };
    const now = 1000 + RENDER_GONE_WINDOW_MS + 1;
    const { decision, nextState } = decideRenderGone(state, { reason: 'crash', exitCode: 1 }, now);
    expect(decision).toEqual({ kind: 'reload' });
    expect(nextState.crashes).toBe(1);
  });

  it('STATUS_BREAKPOINT（杀软/调试器打断）→ security-guard 不自动 reload、不计入崩溃预算', () => {
    const before: RenderGoneState = { crashes: 2, lastCrashAt: 100 };
    const { decision, nextState } = decideRenderGone(
      before,
      { reason: 'crashed', exitCode: STATUS_BREAKPOINT },
      5000,
    );
    expect(decision).toEqual({ kind: 'security-guard' });
    expect(nextState).toEqual(before);
  });

  it('连续 breakpoint 不消耗预算：预算将满时真实崩溃仍 reload（3 次内）', () => {
    // 预算 2 次 + 1 次 breakpoint → 真实崩溃第 3 次 → 仍 reload（未超 3）
    const { decision } = decideRenderGone(
      { crashes: 2, lastCrashAt: 100 },
      { reason: 'crashed', exitCode: 1 },
      200,
    );
    expect(decision).toEqual({ kind: 'reload' });
  });

  it('clean-exit 正常退出 → ignore 不干预（Electron reason 枚举，审查 C1）', () => {
    const state: RenderGoneState = { crashes: 1, lastCrashAt: 100 };
    const { decision, nextState } = decideRenderGone(state, { reason: 'clean-exit', exitCode: 0 }, 200);
    expect(decision).toEqual({ kind: 'ignore' });
    expect(nextState).toEqual(state);
  });

  it('窗口内 3 次上限常量正确', () => {
    expect(MAX_RENDER_GONE_PER_WINDOW).toBe(3);
    expect(RENDER_GONE_WINDOW_MS).toBe(120_000);
  });
});
