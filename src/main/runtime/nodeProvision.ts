/**
 * Node 运行时自给（异步编排/胶水）：探测系统 Node → 缺失/版本不符则下载官方发行版并解压到本地。
 * 纯逻辑（版本/地址/路径）在 nodeRuntime.ts；本文件只做进程、下载、解压编排，不单测。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isNodeOk } from '../service/nodeCheck.js';
import {
  buildNodeDownloadUrl,
  localNodeExe,
  localNpmCli,
  localNpmCmd,
  NODE_DEFAULT_VERSION,
  NODE_MIRROR_NPMMIRROR,
  NODE_MIRROR_OFFICIAL,
  nodeDistName,
  nodeRuntimeDir,
} from './nodeRuntime.js';

export interface NodeRuntime {
  kind: 'system' | 'local';
  nodeExe: string;
  npmCmd: string;
  /** npm 的 CLI JS 入口（node 直跑用，替代 npm.cmd——中文路径安全） */
  npmCli: string;
}

/** 运行一个命令并捕获 stdout（用于 --version 探测）；失败返回 null。 */
function runCapture(exe: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

export async function probeSystemNodeVersion(): Promise<string | null> {
  return runCapture('node', ['--version']);
}

/** 解析可用运行时：优先系统 Node，其次本地下载的运行时；都不行返回 null。 */
export async function resolveNodeRuntime(opts: {
  userData: string;
  platform?: NodeJS.Platform;
}): Promise<NodeRuntime | null> {
  const platform = opts.platform ?? process.platform;
  const sysVer = await probeSystemNodeVersion();
  if (sysVer !== null && isNodeOk(sysVer)) {
    // 系统 node：让 node 自报 execPath 定位 npm-cli.js（比 PATH 解析可靠）
    const execPath = await runCapture('node', ['-p', 'process.execPath']);
    const nodeDir = execPath ? execPath.replace(/[\\/]node\.exe$/i, '') : '';
    const npmCli = nodeDir !== '' && existsSync(localNpmCli(nodeDir)) ? localNpmCli(nodeDir) : '';
    return {
      kind: 'system',
      nodeExe: 'node',
      npmCmd: platform === 'win32' ? 'npm.cmd' : 'npm',
      npmCli,
    };
  }
  const dir = nodeRuntimeDir(opts.userData);
  const exe = localNodeExe(dir, platform);
  if (existsSync(exe)) {
    const ver = await runCapture(exe, ['--version']);
    if (ver !== null && isNodeOk(ver)) {
      return { kind: 'local', nodeExe: exe, npmCmd: localNpmCmd(dir, platform), npmCli: localNpmCli(dir) };
    }
  }
  return null;
}

/** 确保有可用运行时：有就直接返回；没有就下载官方发行版到 <userData>/runtime/node。 */
export async function ensureNodeRuntime(opts: {
  userData: string;
  platform?: NodeJS.Platform;
  arch?: string;
  onProgress?: (detail: string) => void;
}): Promise<NodeRuntime> {
  const existing = await resolveNodeRuntime(opts);
  if (existing) return existing;

  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const dir = nodeRuntimeDir(opts.userData);
  // 清空可能的残留（此前下载损坏等），保证干净落地
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // 下载带 60s 超时 + 镜像回落（npmmirror → 官方）：镜像挂了不再永久卡在"正在下载 Node"
  const mirrors = [NODE_MIRROR_NPMMIRROR, NODE_MIRROR_OFFICIAL];
  let zipBuffer: Buffer | null = null;
  for (const mirror of mirrors) {
    try {
      const url = buildNodeDownloadUrl({ version: NODE_DEFAULT_VERSION, platform, arch, mirror });
      opts.onProgress?.(`正在下载 Node.js ${NODE_DEFAULT_VERSION} …`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) continue;
        zipBuffer = Buffer.from(await response.arrayBuffer());
        break;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // 该镜像超时/失败：换下一个
    }
  }
  if (zipBuffer === null) throw new Error('Node.js 下载失败：镜像与官方源均不可达，请检查网络后重试');
  const zipPath = join(dir, '.node-download.zip');
  await writeFile(zipPath, zipBuffer);

  const tmpDir = join(dir, '.node-tmp');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  opts.onProgress?.('正在解压 Node.js …');
  await runPs(`Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force`);
  const extracted = join(tmpDir, nodeDistName({ version: NODE_DEFAULT_VERSION, platform, arch }));
  for (const entry of readdirSync(extracted)) {
    renameSync(join(extracted, entry), join(dir, entry));
  }
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });

  const exe = localNodeExe(dir, platform);
  const ver = await runCapture(exe, ['--version']);
  if (ver === null || !isNodeOk(ver)) throw new Error(`下载的 Node.js 版本异常：${String(ver)}`);
  return { kind: 'local', nodeExe: exe, npmCmd: localNpmCmd(dir, platform), npmCli: localNpmCli(dir) };
}

function runPs(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`powershell exit ${code}`))));
  });
}
