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

/**
 * 安装用 npm 源：默认 npmmirror（国内镜像）。
 * 实测本机网络下官方 registry.npmjs.org 频繁 ECONNRESET（连接被墙重置，日志里大量 `attempt 1 failed with ECONNRESET`），
 * npmmirror 稳定且更快（213ms vs 官方 949ms）。官方源只作失败回落（见 runInstallFlow）。
 */
export const DSH_NPM_REGISTRY = 'https://registry.npmmirror.com';
export const DSH_NPM_REGISTRY_FALLBACK = 'https://registry.npmjs.org';

export function buildNpmInstallArgs(prefix: string, registry: string = DSH_NPM_REGISTRY): string[] {
  // --fetch-retries=1：源不稳时快速失败，让回落逻辑尽早接管（否则 npm 会反复重试拖很久）
  // --no-audit / --no-fund：跳过审计与赞助信息，少打两次网络请求，少一个失败点
  return ['install', '--prefix', prefix, '--registry', registry, '--fetch-retries=1', '--no-audit', '--no-fund', DSH_PACKAGE];
}

export function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export interface NpmFetchEvent {
  /** 包名（已解码，如 @deepseek-ai/dsh） */
  name: string;
  /** true = 真实下载了一个包（.tgz tarball）；false = 包元数据（manifest）请求 */
  tarball: boolean;
}

/**
 * 解析 npm `--loglevel=http` 的 stderr 行，识别一次真实下载（真实进度来源）。
 * 例：`npm http fetch GET 200 https://registry.npmjs.org/lodash 1160ms (cache miss)`
 * - 命中缓存的包走 `npm http cache … (cache hit)` 行，不是 `fetch`，不计数；
 * - 304（未变化）与所有非下载行返回 null。
 */
export function parseNpmFetchLine(line: string): NpmFetchEvent | null {
  const m = /npm http fetch GET 200 (\S+)/.exec(line);
  if (!m) return null;
  let path: string;
  try {
    path = new URL(m[1]).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
  if (path === '') return null;
  const tarball = /\/-\/[^/]+\.tgz$/.test(path);
  if (tarball) {
    const idx = path.indexOf('/-/');
    if (idx >= 0) path = path.slice(0, idx);
  }
  let name: string;
  try {
    name = decodeURIComponent(path);
  } catch {
    name = path;
  }
  if (name === '') return null;
  return { name, tarball };
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
