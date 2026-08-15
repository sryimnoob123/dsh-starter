/**
 * 用量统计（用户要求：ZCode 那种用量统计界面——全部会话累计，不是单个会话）：
 * 数据源 = DSH session.list：每个会话行自带 projections（host 现成汇总，无需壳聚合）：
 * - sessionStats：turns/steps/llmMs/toolMs/ttftMs/ttftSteps/decodeMs/decodeTokens
 * - tokenUsage：uncachedInputTokens/outputTokens/cacheReadTokens/cacheWriteTokens
 * 纯函数 + 累加；展示层格式化（紧凑 token/时长/命中率/速率）在 usage.html 内联实现。
 */

export interface SessionUsage {
  /** 轮次数（用户消息轮） */
  turns: number;
  /** agent 步数 */
  steps: number;
  /** LLM 请求总墙钟（毫秒） */
  llmMs: number;
  /** 工具调用总墙钟（毫秒） */
  toolMs: number;
  /** 首 token 延迟合计（毫秒；0 = 无步数记录） */
  ttftMs: number;
  /** 记录了首 token 延迟的步数 */
  ttftSteps: number;
  /** 解码总墙钟（毫秒） */
  decodeMs: number;
  /** 解码输出 token 数 */
  decodeTokens: number;
  /** 未命中缓存的输入 token */
  uncachedInputTokens: number;
  /** 输出 token */
  outputTokens: number;
  /** 缓存读取 token */
  cacheReadTokens: number;
  /** 缓存写入 token */
  cacheWriteTokens: number;
}

/** session.list / session.history 投影的 values 形状（其余字段忽略，向后兼容 DSH 升级） */
interface UsageProjections {
  sessionStats?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 从 projections.values 归一化为 SessionUsage；缺字段一律 0（不炸页面） */
export function normalizeSessionUsage(projections: unknown): SessionUsage {
  const proj = (typeof projections === 'object' && projections !== null
    ? projections
    : {}) as UsageProjections;
  const s = proj.sessionStats ?? {};
  const t = proj.tokenUsage ?? {};
  return {
    turns: Math.max(0, Math.round(num(s.turns))),
    steps: Math.max(0, Math.round(num(s.steps))),
    llmMs: Math.max(0, num(s.llmMs)),
    toolMs: Math.max(0, num(s.toolMs)),
    ttftMs: Math.max(0, num(s.ttftMs)),
    ttftSteps: Math.max(0, Math.round(num(s.ttftSteps))),
    decodeMs: Math.max(0, num(s.decodeMs)),
    decodeTokens: Math.max(0, Math.round(num(s.decodeTokens))),
    uncachedInputTokens: Math.max(0, Math.round(num(t.uncachedInputTokens))),
    outputTokens: Math.max(0, Math.round(num(t.outputTokens))),
    cacheReadTokens: Math.max(0, Math.round(num(t.cacheReadTokens))),
    cacheWriteTokens: Math.max(0, Math.round(num(t.cacheWriteTokens))),
  };
}

/** session.list 的一行（只取用量相关字段，其余忽略） */
interface SessionListItem {
  projections?: { values?: unknown };
}

/**
 * 全部会话累计：遍历 session.list 的 items，把每个会话的 projections.values
 * 归一化后逐字段累加。返回总用量 + 参与统计的会话数（[FR-12.2] 全部 token，非单会话）。
 */
export function aggregateSessionUsage(items: unknown): { usage: SessionUsage; sessionCount: number } {
  const usage = normalizeSessionUsage(undefined);
  const list = Array.isArray(items) ? items : [];
  let sessionCount = 0;
  for (const item of list as SessionListItem[]) {
    const values = item?.projections?.values;
    const one = normalizeSessionUsage(values);
    usage.turns += one.turns;
    usage.steps += one.steps;
    usage.llmMs += one.llmMs;
    usage.toolMs += one.toolMs;
    usage.ttftMs += one.ttftMs;
    usage.ttftSteps += one.ttftSteps;
    usage.decodeMs += one.decodeMs;
    usage.decodeTokens += one.decodeTokens;
    usage.uncachedInputTokens += one.uncachedInputTokens;
    usage.outputTokens += one.outputTokens;
    usage.cacheReadTokens += one.cacheReadTokens;
    usage.cacheWriteTokens += one.cacheWriteTokens;
    sessionCount += 1;
  }
  return { usage, sessionCount };
}

// 展示层格式化（紧凑 token/时长/命中率/速率）在 usage.html 内联实现——
// 展示口径归页面单一事实源，避免两处漂移（评审 I1）。

