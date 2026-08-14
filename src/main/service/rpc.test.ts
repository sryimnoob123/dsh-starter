import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildClientRequest, callRpc, RpcError } from './rpc.js';

describe('buildClientRequest', () => {
  it('构造 client-request 信封', () => {
    expect(buildClientRequest('credentials.set', { ref: 'A', value: 'v' }, 'id-1')).toEqual({
      type: 'client-request',
      rpcId: 'id-1',
      method: 'credentials.set',
      payload: { ref: 'A', value: 'v' },
    });
  });
});

describe('callRpc', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 回显请求 rpcId 的成功/失败响应（与真实 server-response 信封一致） */
  function okFetch(result: unknown) {
    const f = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rpcId: string };
      return new Response(
        JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result }),
        { status: 200 },
      );
    });
    return f;
  }

  it('POST 到 /api/<method>，信封与头正确', async () => {
    const f = okFetch({ ok: true, value: {} });
    vi.stubGlobal('fetch', f);
    await callRpc({ port: 3080, method: 'credentials.set', payload: { ref: 'R' } });
    expect(f).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/api/credentials.set',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    const body = JSON.parse(String((f.mock.calls[0]?.[1] as { body?: unknown })?.body));
    expect(body.method).toBe('credentials.set');
    expect(body.type).toBe('client-request');
    expect(body.rpcId).toBeTruthy();
    expect(body.payload).toEqual({ ref: 'R' });
  });

  it('ok:true → 返回 value', async () => {
    vi.stubGlobal('fetch', okFetch({ ok: true, value: { done: 1 } }));
    await expect(
      callRpc({ port: 3080, method: 'settings.update', payload: {} }),
    ).resolves.toEqual({ done: 1 });
  });

  it('ok:false → 抛 RpcError 携带 code/message', async () => {
    vi.stubGlobal(
      'fetch',
      okFetch({ ok: false, error: { code: 'credential-rejected', message: '只读层遮蔽', details: { ref: 'R' } } }),
    );
    const error = await callRpc({ port: 3080, method: 'credentials.set', payload: {} })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe('credential-rejected');
    expect((error as RpcError).message).toContain('只读层遮蔽');
  });

  it('rpcId 不匹配 → 抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ type: 'server-response', rpcId: 'someone-else', result: { ok: true } }),
          { status: 200 },
        ),
      ),
    );
    await expect(callRpc({ port: 3080, method: 'settings.update', payload: {} })).rejects.toThrow(/rpcId/);
  });

  it('HTTP 非 2xx → 抛错含状态码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    await expect(callRpc({ port: 3080, method: 'credentials.set', payload: {} })).rejects.toThrow(/403/);
  });

  it('网络失败 → 抛错含原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(callRpc({ port: 3080, method: 'credentials.set', payload: {} })).rejects.toThrow(/ECONNREFUSED/);
  });
});
