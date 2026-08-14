import { describe, expect, it } from 'vitest';
import {
  averageTtftMs,
  billedInputTokens,
  cacheHitPercent,
  decodeTokensPerSecond,
  formatDuration,
  formatTokens,
  normalizeSessionUsage,
} from './sessionUsage.js';

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
});

describe('用量派生（DSH StatsLine 同款口径）', () => {
  const u = normalizeSessionUsage({
    sessionStats: {},
    tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 3000, cacheWriteTokens: 0 },
  });

  it('billedInputTokens = 未缓存 + 缓存读 + 缓存写', () => {
    expect(billedInputTokens(u)).toBe(4000);
  });

  it('cacheHitPercent 取整；无输入时 null', () => {
    expect(cacheHitPercent(u)).toBe(75);
    const empty = normalizeSessionUsage(null);
    expect(cacheHitPercent(empty)).toBeNull();
  });

  it('averageTtftMs / decodeTokensPerSecond；无数据 null', () => {
    const full = normalizeSessionUsage({
      sessionStats: { ttftMs: 9000, ttftSteps: 3, decodeMs: 4000, decodeTokens: 800 },
      tokenUsage: {},
    });
    expect(averageTtftMs(full)).toBe(3000);
    expect(decodeTokensPerSecond(full)).toBe(200);
    expect(averageTtftMs(u)).toBeNull();
    expect(decodeTokensPerSecond(u)).toBeNull();
  });
});

describe('格式化（紧凑，与 DSH StatsLine 一致）', () => {
  it('formatTokens', () => {
    expect(formatTokens(517)).toBe('517');
    expect(formatTokens(12200)).toBe('12.2K');
    expect(formatTokens(517000)).toBe('517K');
    expect(formatTokens(1484043)).toBe('1.5M');
  });

  it('formatDuration', () => {
    expect(formatDuration(45200)).toBe('45.2s');
    expect(formatDuration(162000)).toBe('2m42s');
    expect(formatDuration(26647221)).toBe('444m7s');
  });
});
