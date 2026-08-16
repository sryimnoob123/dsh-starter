/**
 * Node 运行时自给（纯逻辑）：打包版不依赖系统 Node——缺失/版本不符时自动下载官方发行版。
 * 只含可测的纯逻辑（版本、下载地址、本地路径）；下载/解压的进程编排在 nodeProvision.ts。
 */

import { join, posix } from 'node:path';

/** 下载的 Node 版本（LTS，满足 DSH 要求 ^22.19.0 || >=24） */
export const NODE_DEFAULT_VERSION = 'v22.21.0';

/** 镜像：官方 + npmmirror（官方源被墙时用 npmmirror，海外也可用） */
export const NODE_MIRROR_OFFICIAL = 'https://nodejs.org/dist';
export const NODE_MIRROR_NPMMIRROR = 'https://npmmirror.com/mirrors/node';

export type NodeDistPlatform = 'win' | 'darwin' | 'linux';
export type NodeDistArch = 'x64' | 'arm64';

export function nodeDistPlatform(platform: NodeJS.Platform): NodeDistPlatform {
  return platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux';
}

export function nodeDistArch(arch: string): NodeDistArch {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

/** 发行版目录/文件前缀，如 node-v22.21.0-win-x64 */
export function nodeDistName(opts: { version: string; platform: NodeJS.Platform; arch: string }): string {
  return `node-${opts.version}-${nodeDistPlatform(opts.platform)}-${nodeDistArch(opts.arch)}`;
}

/** 下载文件名（win=zip，其余=tar.gz） */
export function nodeDistFileName(opts: { version: string; platform: NodeJS.Platform; arch: string }): string {
  const ext = opts.platform === 'win32' ? 'zip' : 'tar.gz';
  return `${nodeDistName(opts)}.${ext}`;
}

export function buildNodeDownloadUrl(opts: {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  mirror?: string;
}): string {
  const mirror = (opts.mirror ?? NODE_MIRROR_NPMMIRROR).replace(/\/+$/, '');
  return `${mirror}/${opts.version}/${nodeDistFileName(opts)}`;
}

/** 运行时落地目录：<userData>/runtime/node */
export function nodeRuntimeDir(userData: string): string {
  return join(userData, 'runtime', 'node');
}

export function localNodeExe(dir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? join(dir, 'node.exe') : posix.join(dir, 'bin', 'node');
}

export function localNpmCmd(dir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? join(dir, 'npm.cmd') : posix.join(dir, 'bin', 'npm');
}

/**
 * npm 的 CLI JS 入口（node 直跑用）：`<node目录>/node_modules/npm/bin/npm-cli.js`。
 * 系统 node 与自下载 node zip 结构一致。用它替代 npm.cmd + shell 启动——
 * Windows 下 npm.cmd 经 cmd.exe 按 GBK 解析命令行，中文/空格前缀路径会被拆坏
 * （实测 `Invalid tag name "测试"`），node 直跑（shell:false）则 Unicode 安全。
 */
export function localNpmCli(dir: string): string {
  return join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
}
