/**
 * 用量统计（用户要求：ZCode 那种用量统计，风格与现有 Codex 皮一致）：
 * 数据源 = DSH session.history 尾部页的 projections（host 现成汇总，无需壳聚合）：
 * - sessionStats：turns/steps/llmMs/toolMs/ttftMs/ttftSteps/decodeMs/decodeTokens
 * - tokenUsage：uncachedInputTokens/outputTokens/cacheReadTokens/cacheWriteTokens
 * 纯函数 + 格式化（与 DSH StatsLine 同款紧凑格式：517 / 12.2K / 45.2s / 2m42s）。
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

/** session.history 尾部页的 projections 形状（其余字段忽略，向后兼容 DSH 升级） */
interface UsageProjections {
  sessionStats?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 从 projections 归一化为 SessionUsage；缺字段一律 0（不炸页面） */
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

/** 计费输入 = 未缓存输入 + 缓存读 + 缓存写（DSH billedInputTokens 同款口径） */
export function billedInputTokens(u: SessionUsage): number {
  return u.uncachedInputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}

/** 缓存命中率（百分比整数）；无计费输入时 null */
export function cacheHitPercent(u: SessionUsage): number | null {
  const denominator = billedInputTokens(u);
  return denominator === 0 ? null : Math.round((u.cacheReadTokens / denominator) * 100);
}

/** 紧凑 token 数：517 / 12.2K / 1.2M（DSH StatsLine 同款） */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
  return `${scaled(n / 1_000_000)}M`;
}

/** 紧凑时长：45.2s 以下按秒，之后 2m42s（DSH StatsLine 同款） */
export function formatDuration(ms: number): string {
  const s = ms / 1_000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/** 平均首 token 延迟（毫秒）；无记录时 null */
export function averageTtftMs(u: SessionUsage): number | null {
  return u.ttftSteps === 0 ? null : u.ttftMs / u.ttftSteps;
}

/** 解码速度（tokens/秒，一位小数）；无解码数据时 null */
export function decodeTokensPerSecond(u: SessionUsage): number | null {
  if (u.decodeMs <= 0 || u.decodeTokens <= 0) return null;
  return (u.decodeTokens / (u.decodeMs / 1_000));
}
