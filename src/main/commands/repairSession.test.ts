import { describe, expect, it } from 'vitest';
import {
  buildCreateSessionPayload,
  buildRepairPrompt,
  buildRepairPromptPayload,
  openRepairSession,
  type RepairContext,
} from './repairSession.js';

const baseCtx: RepairContext = {
  shellLogTail: 'shell log tail',
  envSummary: 'v0.4.2 / port 3080 / profile web',
};

/** 模拟 DSH API 网关：按 method 返回信封；记录调用。 */
function fakeFetch(calls: Array<{ method: string; payload: unknown }>) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { method?: unknown; payload?: unknown; rpcId?: unknown };
    calls.push({ method: String(body.method), payload: body.payload });
    const envelope = {
      type: 'server-response',
      rpcId: body.rpcId,
      result:
        body.method === 'session.create'
          ? { ok: true, value: { sessionId: 'repair-1' } }
          : { ok: true, value: { command: { kind: 'success', text: 'ok' } } },
    };
    return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('buildRepairPrompt（修复会话首条消息）', () => {
  it('包含角色设定 + 环境 + 日志 + 建议动作', () => {
    const text = buildRepairPrompt(baseCtx);
    expect(text).toContain('维护助手');
    expect(text).toContain('v0.4.2 / port 3080 / profile web');
    expect(text).toContain('shell log tail');
    expect(text).toContain('建议动作清单');
  });

  it('有自救事件/隔离插件/service 日志时全部带上', () => {
    const text = buildRepairPrompt({
      ...baseCtx,
      rescueSummary: 'isolated dsh-bad-plugin',
      isolatedPlugins: 'dsh-bad-plugin',
      serviceLogTail: 'service log tail',
    });
    expect(text).toContain('isolated dsh-bad-plugin');
    expect(text).toContain('dsh-bad-plugin');
    expect(text).toContain('service log tail');
  });
});

describe('buildCreateSessionPayload（session.create 载荷）', () => {
  it('有 cwd 时带 cwd；无 cwd 时空对象（workspaceId 与 cwd 互斥，只用 cwd）', () => {
    expect(buildCreateSessionPayload('C:\\proj')).toEqual({ cwd: 'C:\\proj' });
    expect(buildCreateSessionPayload()).toEqual({});
  });
});

describe('buildRepairPromptPayload（session.prompt 载荷）', () => {
  it('queue 模式 + 单文本块', () => {
    expect(buildRepairPromptPayload('s1', 'hello')).toEqual({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    });
  });
});

describe('openRepairSession（session.create → session.prompt）', () => {
  it('成功：create 带 cwd → prompt 注入修复消息，返回 sessionId', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const result = await openRepairSession({
      port: 3080,
      ctx: { ...baseCtx, cwd: 'C:\\proj' },
      fetchImpl: fakeFetch(calls) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true, sessionId: 'repair-1' });
    expect(calls.map((c) => c.method)).toEqual(['session.create', 'session.prompt']);
    expect(calls[0].payload).toEqual({ cwd: 'C:\\proj' });
    const promptPayload = calls[1].payload as { sessionId: string; mode: string; content: Array<{ type: string; text: string }> };
    expect(promptPayload.sessionId).toBe('repair-1');
    expect(promptPayload.mode).toBe('queue');
    expect(promptPayload.content[0].text).toContain('维护助手');
  });

  it('session.create 返回异常形状 → 明确报错', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rpcId?: unknown };
      return new Response(
        JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: {} } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const result = await openRepairSession({ port: 3080, ctx: baseCtx, fetchImpl });
    expect(result).toEqual({ ok: false, error: 'session.create 返回异常（无 sessionId）' });
  });

  it('传输失败 → 返回 ok:false 带错误信息（不抛异常）', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await openRepairSession({ port: 1, ctx: baseCtx, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('修复会话失败');
  });
});
