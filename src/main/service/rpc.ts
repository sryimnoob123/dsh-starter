/**
 * DSH API 网关 RPC 客户端（调研 B：packages/client/connection + apiproxy）。
 * 壳 = 浏览器同款客户端（[FR-25.1]）：POST /api/<method>，信封 client-request/server-response。
 * 仅用于 loopback 目标（settings/credentials 域被服务端钉在 loopback，见其 PRIVILEGED_METHODS）。
 */

export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export function buildClientRequest(
  method: string,
  payload: unknown,
  rpcId: string,
): { type: 'client-request'; rpcId: string; method: string; payload: unknown } {
  return { type: 'client-request', rpcId, method, payload };
}

interface ServerResponseEnvelope {
  type: 'server-response';
  rpcId: string;
  result: { ok: true; value?: unknown } | { ok: false; error: { code: string; message: string } };
}

export interface RpcCallOptions {
  port: number;
  method: string;
  payload?: unknown;
  fetchImpl?: typeof fetch;
  /** 超时（ms），默认 15s：服务挂死时桥调用不再无限 await */
  timeoutMs?: number;
}

/** 发起一次 RPC；成功返回 result.value；业务失败抛 RpcError；传输失败/超时抛普通 Error。 */
export async function callRpc(options: RpcCallOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const rpcId = globalThis.crypto.randomUUID();
  const body = JSON.stringify(buildClientRequest(options.method, options.payload ?? {}, rpcId));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${options.port}/api/${options.method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`DSH API 调用失败：HTTP ${response.status}（${options.method}）`);
    }
    const envelope = (await response.json()) as ServerResponseEnvelope;
    if (envelope.rpcId !== rpcId) {
      throw new Error(`rpcId 不匹配（${options.method}）：发送 ${rpcId}，收到 ${String(envelope.rpcId)}`);
    }
    if (envelope.result.ok) return envelope.result.value;
    throw new RpcError(envelope.result.error.code, envelope.result.error.message);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`DSH API 调用超时（${options.method}，${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
