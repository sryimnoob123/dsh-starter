import { describe, expect, it, vi } from 'vitest';
import {
  buildProviderPatch,
  CREDENTIAL_REF,
  PROVIDER_ID,
  saveConnectionToService,
} from './dshConfig.js';

describe('buildProviderPatch', () => {
  it('生成 llm-pi-ai 自定义 provider 补丁', () => {
    expect(buildProviderPatch('https://api.example.com/v1', 'my-model')).toEqual({
      ns: 'llm-pi-ai',
      patch: {
        providers: {
          [PROVIDER_ID]: {
            apiKeyEnv: CREDENTIAL_REF,
            api: 'openai-completions',
            baseURL: 'https://api.example.com/v1',
            models: [{ id: 'my-model' }],
          },
        },
      },
    });
  });

  it('带 models 列表时登记全部模型（DSH 模型选择器可多选）', () => {
    expect(buildProviderPatch('https://api.example.com/v1', 'm1', ['m1', 'm2', 'm3'])).toEqual({
      ns: 'llm-pi-ai',
      patch: {
        providers: {
          [PROVIDER_ID]: {
            apiKeyEnv: CREDENTIAL_REF,
            api: 'openai-completions',
            baseURL: 'https://api.example.com/v1',
            models: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
          },
        },
      },
    });
  });
});

describe('saveConnectionToService', () => {
  type ResultBody = { ok: true; value?: unknown } | { ok: false; error: { code: string; message: string } };

  /** 假 DSH 服务：按 URL 分发，回显请求的 rpcId（与真实 server-response 一致） */
  function mockFetch(calls: Array<{ url: string; respond: ResultBody }>) {
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const found = calls.find((c) => c.url === url);
      if (!found) throw new Error(`unexpected call: ${url}`);
      const body = JSON.parse(String(init?.body)) as { rpcId: string; payload: unknown };
      return new Response(
        JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: found.respond }),
        { status: 200 },
      );
    });
    return f;
  }

  const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-secret', model: 'm1' };

  it('先 credentials.set 后 settings.update，成功后 ok', async () => {
    const f = mockFetch([
      { url: 'http://127.0.0.1:3080/api/credentials.set', respond: { ok: true, value: {} } },
      { url: 'http://127.0.0.1:3080/api/settings.update', respond: { ok: true, value: {} } },
    ]);
    vi.stubGlobal('fetch', f);
    const res = await saveConnectionToService(3080, cfg);
    expect(res.ok).toBe(true);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('/api/credentials.set');
    expect(urls[1]).toContain('/api/settings.update');
    // credentials.set 的 payload 带密钥与固定 ref
    const setBody = JSON.parse(String((f.mock.calls[0]?.[1] as { body?: unknown })?.body));
    expect(setBody.payload).toEqual({ ref: CREDENTIAL_REF, value: 'sk-secret' });
    vi.unstubAllGlobals();
  });

  it('credentials.set 被拒（credential-rejected）→ 返回失败与原因', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        {
          url: 'http://127.0.0.1:3080/api/credentials.set',
          respond: { ok: false, error: { code: 'credential-rejected', message: '环境变量遮蔽' } },
        },
      ]),
    );
    const res = await saveConnectionToService(3080, cfg);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('环境变量遮蔽');
    vi.unstubAllGlobals();
  });

  it('settings.update 被拒（settings-rejected）→ 返回失败与原因', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        { url: 'http://127.0.0.1:3080/api/credentials.set', respond: { ok: true, value: {} } },
        {
          url: 'http://127.0.0.1:3080/api/settings.update',
          respond: { ok: false, error: { code: 'settings-rejected', message: 'schema 拒绝' } },
        },
      ]),
    );
    const res = await saveConnectionToService(3080, cfg);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('schema 拒绝');
    vi.unstubAllGlobals();
  });

  it('网络失败 → 返回失败与指引', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await saveConnectionToService(3080, cfg);
    expect(res.ok).toBe(false);
    expect(res.message).toContain('无法连接');
    vi.unstubAllGlobals();
  });
});
