// prepare-dsh.mjs — 打包前把 DSH 及全部依赖预下载到 vendor/dsh，供 electron-builder 一并打进安装包。
// 目的：安装时免联网下载（消除「官方 registry 被墙 ECONNRESET」类问题），装好即用。
// 幂等：vendor/dsh/node_modules/@deepseek-ai/dsh 已存在则跳过（手动删 vendor/dsh 可强制重下）。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = join(root, 'vendor', 'dsh');
const entry = join(prefix, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
const registry = process.env.DSH_NPM_REGISTRY ?? 'https://registry.npmmirror.com';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (existsSync(entry)) {
  console.log('prepare-dsh: already prepared, skip');
  process.exit(0);
}

mkdirSync(prefix, { recursive: true });
console.log(`prepare-dsh: npm install @deepseek-ai/dsh -> ${prefix} (registry=${registry})`);

const child = spawn(
  npm,
  [
    'install',
    '--prefix',
    prefix,
    '--registry',
    registry,
    '--fetch-retries=1',
    '--no-audit',
    '--no-fund',
    '@deepseek-ai/dsh',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

child.on('error', (err) => {
  console.error('prepare-dsh failed to spawn npm:', err);
  process.exit(1);
});
child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`prepare-dsh failed: npm exit ${code}`);
    process.exit(code ?? 1);
  }
  console.log('prepare-dsh: done');
  process.exit(0);
});
