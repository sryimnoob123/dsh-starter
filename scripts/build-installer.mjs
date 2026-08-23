import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 中等体积、速度优先：只压缩内层应用归档，NSIS 外层仍由 compression: store 禁止二次压缩。
// 可在实验构建时用环境变量覆盖；正式 pnpm dist 默认固定为 level 1，保证可复现。
const level = process.env.DSH_INSTALLER_COMPRESSION_LEVEL ?? '1';
if (!/^[0-9]$/.test(level)) {
  console.error(`invalid DSH_INSTALLER_COMPRESSION_LEVEL: ${level}`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules', 'electron-builder', 'cli.js');
const child = spawn(process.execPath, [cli, '--win', '--config', 'build/electron-builder.yml'], {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, ELECTRON_BUILDER_COMPRESSION_LEVEL: level },
});

child.on('error', (error) => {
  console.error('failed to start electron-builder:', error);
  process.exit(1);
});
child.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const installer = join(root, 'dist', 'installer', `${manifest.productName}-Setup-${manifest.version}.exe`);
  const size = statSync(installer).size;
  // [F1 拍板] 全量打包：无体积上限（种子 329M + DSH 248M 远超 320MiB），门禁改体积报告。
  console.log(`installer size: ${(size / 1024 / 1024).toFixed(1)} MiB (${size} bytes)`);
  // [F1 发布红线] 隐私反证：安装包里出现真实 key/凭据形态 → 拒绝放行（发布绝不含私人文件）。
  // 注意：bundle（tar.gz）是压缩内容，明文搜不到——隐私主防线是 prepare-seed.mjs 的
  // 净化 + 反证扫描；此处是壳层（app.asar/exe 明文）兜底，用精确路径形态防误报
  // （不能匹配 redact.ts 的脱敏正则字面量 \bsk-…，也不能匹配代码里的 session 变量）。
  const buffer = readFileSync(installer);
  const text = buffer.toString('latin1');
  const keyPattern = /\bsk-[A-Za-z0-9_-]{20,}\b/;
  const markers = ['.credentials.yaml', 'dsh-home/sessions', 'dsh-home\\sessions', 'dsh-home/undo-snapshots', 'dsh-home\\undo-snapshots'];
  const markerHits = markers.filter((m) => text.includes(m));
  const keyHit = keyPattern.test(text);
  if (markerHits.length > 0 || keyHit) {
    console.error(`privacy gate failed: markers=${markerHits.join(',')} key=${keyHit}`);
    process.exit(2);
  }
  console.log('privacy gate passed: no credentials/session/key markers in installer');
  process.exit(0);
});
