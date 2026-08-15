import type { PortDecision } from './port.js';

/**
 * managed 模式启动门禁（壳自己拉起并管理服务，不复用外部服务）。
 * 端口决策（free/spawn / dsh→next-free / occupied→ask）统一走环境门禁：
 * - 要拉起服务（spawn / next-free）或换端口（ask），都先要求 Node + DSH 就绪
 * - next-free（端口上是别人的 dsh）与 spawn 同门禁，最终都 spawn（端口由上层探测后决定）
 */

export type StartupGate =
  | { kind: 'guide'; guidance: 'node-missing' | 'dsh-missing' }
  | { kind: 'ask' }
  | { kind: 'spawn' };

export function decideStartup(
  decision: PortDecision,
  state: { nodeOk: boolean; dshDetected: boolean },
): StartupGate {
  // 无论 spawn / next-free / ask，都要能拉起服务 → 先过环境门禁
  if (!state.nodeOk) return { kind: 'guide', guidance: 'node-missing' };
  if (!state.dshDetected) return { kind: 'guide', guidance: 'dsh-missing' };
  if (decision.action === 'ask') return { kind: 'ask' };
  return { kind: 'spawn' };
}
