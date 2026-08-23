/**
 * 渲染进程崩溃判定（缺口 1 纯逻辑，无 electron io——可单测）。
 * 壳主窗口承载 DSH 页面（http://127.0.0.1:3081），渲染进程崩溃时：
 * - STATUS_BREAKPOINT（exitCode -2147483645 = 0x80000003）是安全软件/调试器打断特征，
 *   不是壳自己的问题 → 提示安全软件类文案 + 停手（不反复 reload 刷屏）。
 * - 其他崩溃 → 自动 reload；2 分钟内连续崩溃 >= 3 次停手（防崩溃循环刷屏）。
 */

/** Windows 断点异常退出码（0x80000003 无符号 → -2147483645）：杀软/调试器注入特征 */
export const STATUS_BREAKPOINT = -2147483645;

export interface RenderGoneDetails {
  reason: string;
  exitCode: number;
}

export type RenderGoneDecision =
  /** 清理退出（正常），不干预 */
  | { kind: 'ignore' }
  /** 崩溃 → 允许自动 reload */
  | { kind: 'reload' }
  /** 崩溃但疑似安全软件拦截 → 提示用户，不自动 reload */
  | { kind: 'security-guard' }
  /** 崩溃太频繁 → 停手，提示用户 */
  | { kind: 'give-up' };

export interface RenderGoneState {
  /** 窗口滚动时间窗内的崩溃次数（2 分钟内） */
  crashes: number;
  /** 上次崩溃时间戳（ms，0 = 从未） */
  lastCrashAt: number;
}

export const RENDER_GONE_WINDOW_MS = 2 * 60_000;
export const MAX_RENDER_GONE_PER_WINDOW = 3;

/** 判定渲染进程崩溃处置（纯函数）：窗口内崩溃次数 + 是否安全软件特征。
 *  - clean-exit：正常退出，不干预、不动状态。
 *  - STATUS_BREAKPOINT：杀软/调试器打断，不是应用崩溃——提示用户但不计入
 *    崩溃预算（否则 3 次杀软打断后，真实崩溃会被误判 give-up）。
 *  - 正常崩溃：窗口滑动计数，3 次内 reload，第 4 次 give-up。 */
export function decideRenderGone(
  state: RenderGoneState,
  details: RenderGoneDetails,
  now: number,
): { decision: RenderGoneDecision; nextState: RenderGoneState } {
  // Electron reason 枚举：clean-exit | abnormal-exit | killed | crashed | oom |
  // launch-failed | integrity-failure | memory-eviction（审查 C1：`cleanup` 不存在）
  if (details.reason === 'clean-exit') {
    return { decision: { kind: 'ignore' }, nextState: state };
  }
  if (details.exitCode === STATUS_BREAKPOINT) {
    return { decision: { kind: 'security-guard' }, nextState: state };
  }
  // 窗口滑动：距上次崩溃超过 2 分钟 → 重置窗口计数
  const inWindow = now - state.lastCrashAt < RENDER_GONE_WINDOW_MS;
  const count = inWindow ? state.crashes : 0;
  const nextCount = count + 1;
  const nextState: RenderGoneState = { crashes: nextCount, lastCrashAt: now };
  // 3 次以内允许 reload；第 4 次（窗口内已满）停手——「3 次停手」= 前 3 次重载、第 4 次 give-up
  if (nextCount > MAX_RENDER_GONE_PER_WINDOW) {
    return { decision: { kind: 'give-up' }, nextState };
  }
  return { decision: { kind: 'reload' }, nextState };
}
