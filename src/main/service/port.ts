import type { PortProbe } from './detect.js';

export const DEFAULT_PORT = 3080;

export type PortDecision =
  | { action: 'reuse'; port: number }
  | { action: 'spawn'; port: number }
  | { action: 'ask'; candidatePorts: number[] };

export function decidePort(
  probeResult: PortProbe,
  options: { remembered?: number; defaultPort?: number } = {},
): PortDecision {
  const port = options.remembered ?? options.defaultPort ?? DEFAULT_PORT;
  if (probeResult === 'dsh') return { action: 'reuse', port };
  if (probeResult === 'free') return { action: 'spawn', port };
  return { action: 'ask', candidatePorts: nextFreeCandidates(port) };
}

export function nextFreeCandidates(port: number, count = 3): number[] {
  const base = Math.max(1024, port + 1);
  return Array.from({ length: count }, (_, i) => base + i);
}
