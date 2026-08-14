import { join, posix } from 'node:path';

/**
 * DSH 安装向导的包安装纯逻辑（[FR-22]，方案=npm 装到用户自选目录，用户已确认）：
 * 官方分发 = npm 包 @deepseek-ai/dsh（DSH README：npx @deepseek-ai/dsh web）。
 * --prefix 装到用户选的目录 = 自选目录（[FR-22.3]）+ 独立实例（[FR-22.4]）。
 */

export const DSH_PACKAGE = '@deepseek-ai/dsh';

/** 安装用 npm 源（官方 npmjs 直连常被墙，默认走 npmmirror 镜像） */
export const DSH_NPM_REGISTRY = 'https://registry.npmmirror.com';

export function buildNpmInstallArgs(prefix: string): string[] {
  return ['install', '--prefix', prefix, '--registry', DSH_NPM_REGISTRY, DSH_PACKAGE];
}

export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/** 安装后 dsh 可执行文件路径（win32 有 .cmd 后缀）；非 win32 按 POSIX 拼接（跨平台正确） */
export function dshBinPath(prefix: string, platform: NodeJS.Platform = process.platform): string {
  const bin = platform === 'win32' ? 'dsh.cmd' : 'dsh';
  return platform === 'win32'
    ? join(prefix, 'node_modules', '.bin', bin)
    : posix.join(prefix, 'node_modules', '.bin', bin);
}

/** 安装后 dsh 的 CLI 入口 JS（apps/cli bin: dsh → lib/bin.js）；配合自备 Node 直接 node <入口> 运行，绕过 .cmd 壳依赖系统 node */
export function dshEntryJsPath(prefix: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : posix.join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}

/**
 * 安装向导默认目录（交付页 chooseDir 文案"用默认目录就好"的落地）：
 * win32 → %LOCALAPPDATA%\deepseekharness\dsh（per-user 本地应用区，不进漫游配置）；
 * 其他 → fallback/.dsh-desktop/dsh。fallback 由调用方给（通常是用户主目录）。
 */
export function defaultInstallDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fallback: string,
): string {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    if (local) return join(local, 'deepseekharness', 'dsh');
    return join(fallback, 'dsh');
  }
  return posix.join(fallback, '.dsh-desktop', 'dsh');
}
