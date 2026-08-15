import { describe, expect, it } from 'vitest';
import { aggregateSessionUsage, normalizeSessionUsage } from './sessionUsage.js';

describe('normalizeSessionUsage（session.history projections 归一化）', () => {
  it('从完整 projections 提取字段', () => {
    const u = normalizeSessionUsage({
      sessionStats: {
        turns: 53, steps: 1348, llmMs: 26647221, toolMs: 5286867,
        ttftMs: 9244644, ttftSteps: 1338, decodeMs: 17402577, decodeTokens: 1484043,
      },
      tokenUsage: {
        uncachedInputTokens: 2316443, outputTokens: 1484043,
        cacheReadTokens: 404072064, cacheWriteTokens: 0,
      },
    });
    expect(u).toEqual({
      turns: 53, steps: 1348, llmMs: 26647221, toolMs: 5286867,
      ttftMs: 9244644, ttftSteps: 1338, decodeMs: 17402577, decodeTokens: 1484043,
      uncachedInputTokens: 2316443, outputTokens: 1484043,
      cacheReadTokens: 404072064, cacheWriteTokens: 0,
    });
  });

  it('缺字段/坏数据一律归 0（DSH 升级向后兼容，不炸页面）', () => {
    expect(normalizeSessionUsage(null)).toEqual({
      turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
      decodeMs: 0, decodeTokens: 0,
      uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    });
    expect(normalizeSessionUsage({ sessionStats: { turns: -5, llmMs: 'x' }, tokenUsage: { outputTokens: 1.6 } }))
      .toMatchObject({ turns: 0, llmMs: 0, outputTokens: 2 });
  });

  it('浮点/负数输入被归整且不为负', () => {
    const u = normalizeSessionUsage({
      sessionStats: { turns: 2.7, steps: -3 },
      tokenUsage: { cacheReadTokens: 12.6, cacheWriteTokens: -5 },
    });
    expect(u.turns).toBe(3);
    expect(u.steps).toBe(0);
    expect(u.cacheReadTokens).toBe(13);
    expect(u.cacheWriteTokens).toBe(0);
  });
});

describe('aggregateSessionUsage（session.list 全部会话累计，[FR-12.2]）', () => {
  const row = (turns: number, input: number, output: number) => ({
    projections: {
      values: {
        sessionStats: { turns, steps: 1, llmMs: 100, toolMs: 50, ttftMs: 10, ttftSteps: 1, decodeMs: 20, decodeTokens: 5 },
        tokenUsage: { uncachedInputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    },
  });

  it('遍历累加每个会话的 projections.values', () => {
    const { usage, sessionCount } = aggregateSessionUsage([row(2, 100, 50), row(3, 200, 100)]);
    expect(sessionCount).toBe(2);
    expect(usage.turns).toBe(5);
    expect(usage.uncachedInputTokens).toBe(300);
    expect(usage.outputTokens).toBe(150);
    expect(usage.llmMs).toBe(200);
    expect(usage.ttftSteps).toBe(2);
    expect(usage.decodeTokens).toBe(10);
  });

  it('缺投影/空列表一律归 0，不炸（DSH 升级向后兼容）', () => {
    expect(aggregateSessionUsage(null)).toEqual({
      usage: normalizeSessionUsage(undefined),
      sessionCount: 0,
    });
    expect(aggregateSessionUsage([{ projections: undefined }, { projections: { values: undefined } }]))
      .toEqual({ usage: normalizeSessionUsage(undefined), sessionCount: 2 });
  });
});
