import type { PortDecision } from './port.js';

/**
 * 启动门禁（打包版关键路径：复用优先于本地检测）。
 * 打包安装的应用没有 DSH_CHECKOUT 环境变量、也未必装过 DSH——
 * 但用户本机可能已有 dsh 服务在跑，探测到就应该直接复用，而不是误报"未检测到 DSH"。
 * 本地检测（nodeOk/dshDetected）只在需要**拉起**服务时才要求。
 */

export type StartupGate =
  | { kind: 'reuse' }
  | { kind: 'guide'; guidance: 'node-missing' | 'dsh-missing' }
  | { kind: 'ask' }
  | { kind: 'spawn' };

export function decideStartup(
  decision: PortDecision,
  state: { nodeOk: boolean; dshDetected: boolean },
): StartupGate {
  // 端口上是 dsh 服务 → 直接复用，不要求本机检出（外部服务自带运行时）
  if (decision.action === 'reuse') return { kind: 'reuse' };
  // 端口空闲/被占都要拉起自己的服务：先过环境门禁
  if (!state.nodeOk) return { kind: 'guide', guidance: 'node-missing' };
  if (!state.dshDetected) return { kind: 'guide', guidance: 'dsh-missing' };
  if (decision.action === 'ask') return { kind: 'ask' };
  return { kind: 'spawn' };
}
