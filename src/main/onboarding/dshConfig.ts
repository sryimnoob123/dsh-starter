import type { ConnectionConfig, ConnectionResult } from '../bridge/contract.js';
import { callRpc, RpcError } from '../service/rpc.js';

/**
 * 首启向导"接入 AI"的保存路径（[FR-30.7] 手工路径，方案=调 DSH 服务 API，用户已确认）：
 * 1. credentials.set —— 密钥写入服务端凭据存储（settings 只存引用名，不带明文）
 * 2. settings.update —— llm-pi-ai 登记自定义 OpenAI 兼容 provider（providers.md 记载的字段）
 * 顺序：先 set 后 update——update 失败只会留下一个无害的孤儿密钥，反之会留下无密钥的 provider。
 * provider id / credential ref 固定（幂等）：重复保存 = 覆盖同一条。
 */

export const PROVIDER_ID = 'desktop';
export const CREDENTIAL_REF = 'DSH_DESKTOP_KEY';
/** DeepSeek 官方 provider（llm-deepseek, route deepseek-official）生态约定的凭据引用名 */
export const DEEPSEEK_CREDENTIAL_REF = 'DEEPSEEK_API_KEY';

/** DeepSeek 官方 API 主机（走 llm-deepseek 官方 provider，原生支持思考强度 off/high/max） */
export const DEEPSEEK_OFFICIAL_HOST = 'api.deepseek.com';

/** 是否是 DeepSeek 官方端点（onboarding 命中时改配官方 provider，否则思考强度不可调） */
export function isDeepSeekOfficialBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === DEEPSEEK_OFFICIAL_HOST;
  } catch {
    return false;
  }
}

export function buildProviderPatch(baseUrl: string, model: string, models?: string[]): {
  ns: string;
  patch: Record<string, unknown>;
} {
  const ids = models !== undefined && models.length > 0 ? models : [model];
  return {
    ns: 'llm-pi-ai',
    patch: {
      providers: {
        [PROVIDER_ID]: {
          apiKeyEnv: CREDENTIAL_REF,
          api: 'openai-completions',
          baseURL: baseUrl,
          models: ids.map((id) => ({ id })),
        },
      },
    },
  };
}

/**
 * DeepSeek 官方接入补丁（ns=llm-deepseek，route=deepseek-official）：
 * 官方 provider 的原生适配器自带思考支持（reasoningEffort off/high/max），
 * 而 pi-ai 通用 openai-completions 对未声明 reasoningEfforts 的模型一律 reasoning=false——
 * 这就是"官方 key 也改不了思考强度"的根因。
 */
export function buildDeepSeekPatch(baseUrl: string, model: string, models?: string[]): {
  ns: string;
  patch: Record<string, unknown>;
} {
  const ids = models !== undefined && models.length > 0 ? models : [model];
  return {
    ns: 'llm-deepseek',
    patch: {
      // 用生态约定名 DEEPSEEK_API_KEY：与 DSH 内置路由默认一致，设置页看到的名字也对得上
      apiKeyEnv: DEEPSEEK_CREDENTIAL_REF,
      baseURL: baseUrl.replace(/\/+$/, ''),
      models: ids.map((id) => ({ id })),
    },
  };
}

export async function saveConnectionToService(
  port: number,
  cfg: ConnectionConfig,
  fetchImpl?: typeof fetch,
): Promise<ConnectionResult> {
  try {
    // 凭据名按路由区分：官方 DeepSeek → DEEPSEEK_API_KEY（内置路由默认名）；
    // 其他端点 → DSH_DESKTOP_KEY（自定义 provider）
    const isOfficial = isDeepSeekOfficialBaseUrl(cfg.baseUrl);
    await callRpc({
      port,
      method: 'credentials.set',
      payload: { ref: isOfficial ? DEEPSEEK_CREDENTIAL_REF : CREDENTIAL_REF, value: cfg.apiKey },
      fetchImpl,
    });
    // DeepSeek 官方端点 → 配 llm-deepseek 官方 section（思考强度原生可调）；
    // 其他端点 → 通用 pi-ai openai-completions provider
    const { ns, patch } = isOfficial
      ? buildDeepSeekPatch(cfg.baseUrl, cfg.model, cfg.models)
      : buildProviderPatch(cfg.baseUrl, cfg.model, cfg.models);
    await callRpc({ port, method: 'settings.update', payload: { ns, patch }, fetchImpl });
    return {
      ok: true,
      message: isOfficial
        ? '已保存：DeepSeek 官方接入完成，思考强度可以调节了。'
        : '已保存：密钥写入凭据存储，provider 登记完成，即时生效。',
    };
  } catch (error) {
    if (error instanceof RpcError) {
      if (error.code === 'credential-rejected') {
        return { ok: false, message: `密钥保存被拒：${error.message}。若有同名环境变量遮蔽请先移除。` };
      }
      if (error.code === 'settings-rejected' || error.code === 'settings-not-exposed' || error.code === 'settings-conflict') {
        return { ok: false, message: `配置写入失败：${error.message}。可到设置页手动添加该 provider。` };
      }
      return { ok: false, message: `保存失败：${error.message}` };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `无法连接 DSH 服务：${reason}。请确认服务已启动后重试。` };
  }
}
