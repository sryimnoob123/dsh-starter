import { describe, expect, it, vi } from 'vitest';
import {
  buildDeepSeekPatch,
  buildProviderPatch,
  CREDENTIAL_REF,
  DEEPSEEK_CREDENTIAL_REF,
  isDeepSeekOfficialBaseUrl,
  PROVIDER_ID,
  saveConnectionToService,
} from './dshConfig.js';

describe('isDeepSeekOfficialBaseUrl', () => {
  it('识别官方端点（含 /v1 与尾斜杠）', () => {
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com')).toBe(true);
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com/v1')).toBe(true);
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com/')).toBe(true);
  });

  it('非官方端点/非法 URL → false', () => {
    expect(isDeepSeekOfficialBaseUrl('https://api.example.com/v1')).toBe(false);
    expect(isDeepSeekOfficialBaseUrl('https://gateway.deepseek.example/v1')).toBe(false);
    expect(isDeepSeekOfficialBaseUrl('not-a-url')).toBe(false);
  });
});

describe('buildDeepSeekPatch（官方 llm-deepseek section，思考强度原生可调）', () => {
  it('生成 llm-deepseek 补丁（apiKeyEnv 用生态约定名 DEEPSEEK_API_KEY）', () => {
    expect(buildDeepSeekPatch('https://api.deepseek.com/', 'deepseek-chat')).toEqual({
      ns: 'llm-deepseek',
      patch: {
        apiKeyEnv: DEEPSEEK_CREDENTIAL_REF,
        baseURL: 'https://api.deepseek.com',
        models: [{ id: 'deepseek-chat' }],
      },
    });
  });

  it('带 models 列表时登记全部模型', () => {
    expect(buildDeepSeekPatch('https://api.deepseek.com/v1', 'm1', ['m1', 'm2'])).toEqual({
      ns: 'llm-deepseek',
      patch: {
        apiKeyEnv: DEEPSEEK_CREDENTIAL_REF,
        baseURL: 'https://api.deepseek.com/v1',
        models: [{ id: 'm1' }, { id: 'm2' }],
      },
    });
  });
});

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

  it('DeepSeek 官方端点 → 凭据存 DEEPSEEK_API_KEY + settings.update 走 llm-deepseek（思考强度可调）', async () => {
    const f = mockFetch([
      { url: 'http://127.0.0.1:3080/api/credentials.set', respond: { ok: true, value: {} } },
      { url: 'http://127.0.0.1:3080/api/settings.update', respond: { ok: true, value: {} } },
    ]);
    vi.stubGlobal('fetch', f);
    const res = await saveConnectionToService(3080, {
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-secret',
      model: 'deepseek-reasoner',
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('思考强度');
    const setBody = JSON.parse(String((f.mock.calls[0]?.[1] as { body?: unknown })?.body));
    expect(setBody.payload.ref).toBe(DEEPSEEK_CREDENTIAL_REF); // 内置路由要的名字
    const updateBody = JSON.parse(String((f.mock.calls[1]?.[1] as { body?: unknown })?.body));
    expect(updateBody.payload.ns).toBe('llm-deepseek');
    expect(updateBody.payload.patch.apiKeyEnv).toBe(DEEPSEEK_CREDENTIAL_REF);
    expect(updateBody.payload.patch.models).toEqual([{ id: 'deepseek-reasoner' }]);
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
