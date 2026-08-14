/**
 * dsh web 启动命令构造（架构文档 §4.1/§8.7）：
 * - `dsh web --port <n>`，可选 `--patch <桌面基线>`（launcher/web 均支持，调研 A）
 * - DSH_HOME 仅经环境变量注入（安装向导独立实例 [FR-22.4]）
 */

export interface SpawnOptions {
  port: number;
  /** 桌面 patch 基线（userData/desktop.patch.yml），无则不传 */
  patchFile?: string;
}

export function buildCommandArgs(options: SpawnOptions): string[] {
  const args = ['dsh', 'web', '--port', String(options.port)];
  if (options.patchFile) {
    args.push('--patch', options.patchFile);
  }
  return args;
}

export interface SpawnSpec {
  command: string;
  args: string[];
}

export function buildSpawnSpec(
  options: SpawnOptions & { command?: string },
): SpawnSpec {
  const raw = (options.command ?? 'pnpm dsh').split(' ').filter(Boolean);
  const command = raw[0];
  const prefixArgs = raw.slice(1);
  const tail = buildCommandArgs(options);
  // 当 executable 本身是 dsh（或前缀已含 dsh）时，去掉 tail 里重复的 'dsh'
  const commandIsDsh = command === 'dsh' || /[\\/]dsh(\.cmd|\.exe)?$/.test(command);
  const hasDshPrefix = prefixArgs.includes('dsh') || commandIsDsh;
  return { command, args: [...prefixArgs, ...(hasDshPrefix ? tail.slice(1) : tail)] };
}

/**
 * 自备 Node 直跑 DSH CLI：`node <dsh-lib/bin.js> web --port <n> [--patch …]`。
 * 用于打包版（安装向导装出的 DSH + 自下载的 Node），不依赖系统 node/npm。
 */
export function buildNodeSpawnSpec(options: {
  nodeExe: string;
  dshEntry: string;
  port: number;
  patchFile?: string;
}): SpawnSpec {
  const args = [options.dshEntry, 'web', '--port', String(options.port)];
  if (options.patchFile) args.push('--patch', options.patchFile);
  return { command: options.nodeExe, args };
}

export function buildSpawnEnv(
  options: { dshHome?: string; base?: NodeJS.ProcessEnv },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(options.base ?? process.env) };
  if (options.dshHome) {
    env.DSH_HOME = options.dshHome;
  }
  return env;
}
