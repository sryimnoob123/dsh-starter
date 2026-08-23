// prepare-dsh.mjs — 打包前把 DSH 及全部依赖预下载到 vendor/dsh，供 electron-builder 一并打进安装包。
// 目的：安装时免联网下载（消除「官方 registry 被墙 ECONNRESET」类问题），装好即用。
// 幂等：vendor/dsh/node_modules/@deepseek-ai/dsh 已存在则跳过（手动删 vendor/dsh 可强制重下）。
// 安装器：优先 pnpm（本仓库 node-linker=hoisted，保证插件 peer 依赖平铺到顶层 @deepseek-ai/，
//       且 DSH 0.1.0-rc.8 需要顶层可解析 @deepseek-ai/schemastery 等）；在隔离目录安装后移入，
//       避免 pnpm workspace 对 vendor/dsh 的干扰。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = join(root, 'vendor', 'dsh');
const entry = join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const registry = process.env.DSH_NPM_REGISTRY ?? 'https://registry.npmmirror.com';

if (existsSync(entry)) {
  console.log('prepare-dsh: already prepared, skip');
  process.exit(0);
}

mkdirSync(prefix, { recursive: true });

// pnpm is the canonical installer (pnpm-lock.yaml + node-linker=hoisted layout).
// Detect it and use an isolated temp dir so the workspace root cannot shadow it.
const usePnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const hasPnpm = spawnSync(usePnpm, ['--version'], { stdio: 'ignore' }).status === 0;

if (!hasPnpm) {
  console.error('prepare-dsh: pnpm not found on PATH; run via `pnpm dist` or install pnpm');
  process.exit(1);
}

const isolated = join(tmpdir(), 'dsh-vendor-prep-' + process.pid);
mkdirSync(isolated, { recursive: true });

// Seed the isolated dir with vendor/dsh's package.json and a hoisted workspace
// manifest so the resulting tree mirrors the shipped layout exactly.
cpSync(join(prefix, 'package.json'), join(isolated, 'package.json'), { force: true });
const ws = [
  'packages:',
  '  - .',
  '',
  'nodeLinker: hoisted',
  'autoInstallPeers: false',
  '',
  'onlyBuiltDependencies:',
  '  - "@deepseek-ai/dsh-subprocess-local"',
  '  - koffi',
  '  - node-pty',
  '  - "@google/genai"',
  '  - protobufjs',
  ''
].join('\n');
writeFileSync(join(isolated, 'pnpm-workspace.yaml'), ws, 'utf8');

console.log('prepare-dsh: pnpm install @deepseek-ai/dsh (isolated, hoisted) -> ' + isolated);

// Run pnpm install inside the isolated dir, then move node_modules + lockfile back.
const install = spawnSync(usePnpm, ['install', '--registry', registry, '--fetch-retries=3'], {
  cwd: isolated,
  stdio: 'inherit',
  env: { ...process.env, HTTP_PROXY: process.env.DSH_HTTP_PROXY ?? process.env.HTTP_PROXY, HTTPS_PROXY: process.env.DSH_HTTPS_PROXY ?? process.env.HTTPS_PROXY },
});

if (install.status !== 0) {
  console.error('prepare-dsh failed: pnpm install exit ' + install.status);
  rmSync(isolated, { recursive: true, force: true });
  process.exit(install.status ?? 1);
}

const freshModules = join(isolated, 'node_modules');
if (!existsSync(freshModules)) {
  console.error('prepare-dsh failed: isolated install produced no node_modules');
  rmSync(isolated, { recursive: true, force: true });
  process.exit(1);
}

// Replace vendor/dsh/node_modules wholesale (avoid stale partial trees).
const targetModules = join(prefix, 'node_modules');
if (existsSync(targetModules)) rmSync(targetModules, { recursive: true, force: true });
cpSync(freshModules, targetModules, { recursive: true });
for (const f of readdirSync(isolated)) {
  if (f === 'node_modules' || f === 'package.json' || f === 'pnpm-workspace.yaml') continue;
  cpSync(join(isolated, f), join(prefix, f), { recursive: true, force: true });
}
rmSync(isolated, { recursive: true, force: true });

if (!existsSync(entry)) {
  console.error('prepare-dsh failed: bin.js still missing after install');
  process.exit(1);
}
console.log('prepare-dsh: done (' + entry + ')');