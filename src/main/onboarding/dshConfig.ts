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

export async function saveConnectionToService(
  port: number,
  cfg: ConnectionConfig,
  fetchImpl?: typeof fetch,
): Promise<ConnectionResult> {
  try {
    await callRpc({
      port,
      method: 'credentials.set',
      payload: { ref: CREDENTIAL_REF, value: cfg.apiKey },
      fetchImpl,
    });
    const { ns, patch } = buildProviderPatch(cfg.baseUrl, cfg.model, cfg.models);
    await callRpc({ port, method: 'settings.update', payload: { ns, patch }, fetchImpl });
    return { ok: true, message: '已保存：密钥写入凭据存储，provider 登记完成，即时生效。' };
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
