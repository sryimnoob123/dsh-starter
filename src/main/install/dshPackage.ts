import { join, posix } from 'node:path';

/**
 * DSH 安装向导的包安装纯逻辑（[FR-22]，方案=npm 装到用户自选目录，用户已确认）：
 * 官方分发 = npm 包 @deepseek-ai/dsh（DSH README：npx @deepseek-ai/dsh web）。
 * --prefix 装到用户选的目录 = 自选目录（[FR-22.3]）+ 独立实例（[FR-22.4]）。
 */

export const DSH_PACKAGE = '@deepseek-ai/dsh';

/**
 * 检测 PATH 里是否有全局 dsh 命令（managed 模式：优先复用本机已装 dsh，没有才下载）。
 * - win32：找每个 PATH 目录下的 `dsh.cmd`（npm 全局安装的 dsh）
 * - 其他平台：找每个 PATH 目录下的 `dsh`
 * 纯函数：exists 判定注入，便于测试。
 */
export function findGlobalDsh(
  platform: NodeJS.Platform,
  pathEnv: string,
  exists: (p: string) => boolean,
): boolean {
  const sep = platform === 'win32' ? ';' : ':';
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh';
  return pathEnv.split(sep).some((dir) => {
    const trimmed = dir.trim();
    if (trimmed === '') return false;
    try {
      return exists(platform === 'win32' ? join(trimmed, name) : posix.join(trimmed, name));
    } catch {
      return false;
    }
  });
}

/** 安装用 npm 源：默认官方 registry（实测比镜像快约 3.7 倍）；被墙时自动回落镜像（见 runNpmInstall） */
export const DSH_NPM_REGISTRY = 'https://registry.npmjs.org';
export const DSH_NPM_REGISTRY_MIRROR = 'https://registry.npmmirror.com';

export function buildNpmInstallArgs(prefix: string, registry: string = DSH_NPM_REGISTRY): string[] {
  return ['install', '--prefix', prefix, '--registry', registry, DSH_PACKAGE];
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
