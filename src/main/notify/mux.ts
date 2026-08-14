/**
 * DSH events.mux 信封解包：
 * 新版 mux 把所有帧（订阅确认、session/jobs 等事件）统一包成
 * { type: 'server-request', rpcId, method, payload } 下推——真正的帧在 payload 里。
 * 壳（浏览器同款客户端）不回应这些 server-request（downlink-only，回应会断开），
 * 但必须解出 payload 才能拿到事件。旧版裸帧（type 直接是事件名）原样放行，向后兼容。
 */

export function unwrapMuxEnvelope(raw: unknown): unknown {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (obj.type === 'server-request' && typeof obj.payload === 'object' && obj.payload !== null) {
      return obj.payload;
    }
  }
  return raw;
}
