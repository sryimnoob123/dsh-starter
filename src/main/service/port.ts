import type { PortProbe } from './detect.js';

export const DEFAULT_PORT = 3080;

export type PortDecision =
  | { action: 'spawn'; port: number }
  | { action: 'next-free'; candidatePorts: number[] }
  | { action: 'ask'; candidatePorts: number[] };

/**
 * managed 模式端口决策：壳不再复用外部服务。
 * - free → spawn（在目标端口拉起自己的服务）
 * - dsh（端口上是别人的 dsh）→ next-free：自动换空闲端口，不弹窗
 * - occupied（未知程序占用）→ ask：弹窗让用户选
 */
export function decidePort(
  probeResult: PortProbe,
  options: { remembered?: number; defaultPort?: number } = {},
): PortDecision {
  const port = options.remembered ?? options.defaultPort ?? DEFAULT_PORT;
  if (probeResult === 'free') return { action: 'spawn', port };
  const candidates = nextFreeCandidates(port);
  if (probeResult === 'dsh') return { action: 'next-free', candidatePorts: candidates };
  return { action: 'ask', candidatePorts: candidates };
}

export function nextFreeCandidates(port: number, count = 3): number[] {
  const base = Math.max(1024, port + 1);
  return Array.from({ length: count }, (_, i) => base + i);
}
