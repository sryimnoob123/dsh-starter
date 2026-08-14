/**
 * 引导态错误分类（架构文档 §3.4 五种失败原因 → 差异化"怎么办"，[FR-21.3]）：
 * port-occupied（换端口）/ node-missing（装 Node）/ dsh-missing（安装向导）/
 * spawn-crash（退出码+日志+重试）/ config-broken（备份与重置）。
 */

import type { PortProbe } from '../service/detect.js';

export interface StartupContext {
  nodeOk: boolean;
  dshDetected: boolean;
  probe: PortProbe;
  spawnExitCode: number | null;
  configBroken?: boolean;
}

export type GuidanceKey =
  | 'port-occupied'
  | 'node-missing'
  | 'dsh-missing'
  | 'spawn-crash'
  | 'config-broken';

export interface Guidance {
  page: 'service-not-running' | 'install-wizard';
  guidance: GuidanceKey;
}

export function classifyStartupFailure(ctx: StartupContext): Guidance | null {
  if (!ctx.nodeOk) return { page: 'service-not-running', guidance: 'node-missing' };
  if (!ctx.dshDetected) return { page: 'install-wizard', guidance: 'dsh-missing' };
  if (ctx.probe === 'occupied') return { page: 'service-not-running', guidance: 'port-occupied' };
  if (ctx.spawnExitCode !== null) return { page: 'service-not-running', guidance: 'spawn-crash' };
  if (ctx.configBroken) return { page: 'service-not-running', guidance: 'config-broken' };
  return null;
}
