import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthHeaders, buildModelsUrl, discoverModels, testConnection } from './connection.js';

describe('buildModelsUrl', () => {
  it('拼接 /models', () => {
    expect(buildModelsUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/models');
  });

  it('去除尾部多余斜杠', () => {
    expect(buildModelsUrl('https://api.deepseek.com/v1///')).toBe('https://api.deepseek.com/v1/models');
  });

  it('允许 http 本机端点', () => {
    expect(buildModelsUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/models');
  });
});

describe('buildAuthHeaders', () => {
  it('生成 Bearer 头', () => {
    expect(buildAuthHeaders('sk-abc')).toEqual({ Authorization: 'Bearer sk-abc' });
  });
});

describe('testConnection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('200 → ok，且请求打到 /models 带 Bearer 头', async () => {
    const f = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', f);
    const res = await testConnection({ baseUrl: 'https://api.example.com', apiKey: 'sk-x', model: 'm' });
    expect(res.ok).toBe(true);
    expect(f).toHaveBeenCalledWith(
      'https://api.example.com/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-x' } }),
    );
  });

  it('401 → 密钥无效提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const res = await testConnection({ baseUrl: 'https://api.example.com', apiKey: 'bad', model: 'm' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('密钥');
  });

  it('404 → 地址提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const res = await testConnection({ baseUrl: 'https://api.example.com', apiKey: 'k', model: 'm' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('地址');
  });

  it('网络失败 → 无法连接提示（含原因）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await testConnection({ baseUrl: 'https://api.example.com', apiKey: 'k', model: 'm' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('无法连接');
    expect(res.message).toContain('ECONNREFUSED');
  });

  it('配置非法 → 直接失败且不发请求', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await testConnection({ baseUrl: 'ftp://x', apiKey: 'k', model: 'm' });
    expect(res.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('discoverModels（onboarding"自动获取模型"，[FR-30.7] 保姆级）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('OpenAI 标准 {data:[{id}]} → 返回模型 id 列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
          { status: 200 },
        ),
      ),
    );
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' });
    expect(res).toEqual({ ok: true, models: ['deepseek-chat', 'deepseek-reasoner'], message: '找到 2 个模型。' });
  });

  it('裸数组形态也接受（个别端点不包 data）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ id: 'm1' }, { id: 'm2' }]), { status: 200 })),
    );
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' });
    expect(res).toEqual({ ok: true, models: ['m1', 'm2'], message: '找到 2 个模型。' });
  });

  it('过滤无 id 的条目', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'm1' }, { name: 'no-id' }, { id: 'm3' }] }), {
          status: 200,
        }),
      ),
    );
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x' });
    expect(res).toEqual({ ok: true, models: ['m1', 'm3'], message: '找到 2 个模型。' });
  });

  it('401 → 密钥提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'bad' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('密钥');
  });

  it('404 → 提示该端点不支持自动获取，请手动填写', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'k' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('不支持');
  });

  it('空列表 → 失败提示手动填写', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'k' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('手动');
  });

  it('网络失败 → 失败含原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await discoverModels({ baseUrl: 'https://api.example.com/v1', apiKey: 'k' });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('ECONNREFUSED');
  });

  it('地址非法 → 直接失败且不发请求', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await discoverModels({ baseUrl: 'ftp://x', apiKey: 'k' });
    expect(res.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
