import { parseConnectionConfig, type ConnectionResult } from '../bridge/contract.js';

/**
 * 首启向导"接入 AI"（[FR-30.7] 手工路径）：
 * 测试连接 = GET {baseUrl}/models 带 Bearer 密钥。这是 OpenAI 兼容端点最通用的
 * 无成本探测（不消耗 token）；个别服务不支持 /models 会得到 404，提示文案已覆盖。
 */

export function buildModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

export function buildAuthHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function testConnection(
  raw: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionResult> {
  const cfg = parseConnectionConfig(raw);
  if (!cfg) {
    return { ok: false, message: '配置不完整：请填写 API 地址、API 密钥与模型名。' };
  }
  try {
    const res = await fetchImpl(buildModelsUrl(cfg.baseUrl), {
      method: 'GET',
      headers: buildAuthHeaders(cfg.apiKey),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true, message: '连接成功。' };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: '密钥无效或无权限（HTTP 401/403）。请检查 API 密钥。' };
    }
    if (res.status === 404) {
      return {
        ok: false,
        message: '地址似乎不对（HTTP 404）。API 地址应填到域名或 /v1 为止，不要带 /chat/completions；个别服务不支持本探测，可尝试直接保存后使用。',
      };
    }
    return { ok: false, message: `服务返回异常状态（HTTP ${res.status}）。请检查地址与密钥。` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `无法连接：${reason}。请检查地址、网络或代理。` };
  }
}

// ---------------------------------------------------------------------------
// 模型自动获取（onboarding"自动获取模型"按钮；DSH GUI"Fetch available models"同原理）
// ---------------------------------------------------------------------------

export interface DiscoverResult {
  ok: boolean;
  models: string[];
  message?: string;
}

/** 兼容两种响应形态：OpenAI 标准 {data:[{id}]} 与裸数组；过滤无 id 条目 */
function parseModelIds(body: unknown): string[] {
  if (!Array.isArray(body)) {
    if (typeof body === 'object' && body !== null && Array.isArray((body as { data?: unknown }).data)) {
      body = (body as { data: unknown }).data;
    } else {
      return [];
    }
  }
  return (body as Array<{ id?: unknown }>)
    .filter((item) => typeof item === 'object' && item !== null && typeof item.id === 'string')
    .map((item) => item.id as string);
}

export async function discoverModels(
  raw: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoverResult> {
  const parsed = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
  const baseUrl = typeof parsed?.baseUrl === 'string' ? parsed.baseUrl.trim() : '';
  const apiKey = typeof parsed?.apiKey === 'string' ? parsed.apiKey.trim() : '';
  if (!/^https?:\/\//i.test(baseUrl) || apiKey === '') {
    return { ok: false, models: [], message: '请先填写 API 地址与 API 密钥。' };
  }
  try {
    const res = await fetchImpl(buildModelsUrl(baseUrl), {
      method: 'GET',
      headers: buildAuthHeaders(apiKey),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, models: [], message: '密钥无效或无权限（HTTP 401/403）。请检查 API 密钥。' };
      }
      if (res.status === 404) {
        return { ok: false, models: [], message: '该端点不支持自动获取模型列表，请手动填写模型名。' };
      }
      return { ok: false, models: [], message: `获取失败（HTTP ${res.status}）。请手动填写模型名。` };
    }
    const models = parseModelIds(await res.json());
    if (models.length === 0) {
      return { ok: false, models: [], message: '端点没有返回可用模型，请手动填写模型名。' };
    }
    return { ok: true, models, message: `找到 ${models.length} 个模型。` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, models: [], message: `无法连接：${reason}。请手动填写模型名。` };
  }
}
