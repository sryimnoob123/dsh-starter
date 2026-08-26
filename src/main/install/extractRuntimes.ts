/**
 * 首启解压（2026-08-25 tgz 归档方案，设计文档 docs/aegis/work/2026-08-25-tgz-firstrun-design.md）：
 * 打包期把 dsh 运行时 + 种子目录各打成单 tgz（scripts/prepare-archives.mjs），NSIS 只解压
 * 2 个大文件（安装 10 分钟 → 秒级），首启用系统 tar.exe 流式解压回安装目录
 * （本机实测：29738 文件 26s / 13560 文件 12s；VM 虚拟磁盘 2-3 倍仍 < 4 分钟首启预算）。
 *
 * 幂等：完成标记 <installDir>/dsh-archives/.extract-complete 存在 且 runtime bin.js 就绪 → 跳过。
 * 标记必须独立于两个会被删除/重建的目录：dsh-home-seed（阶段2 finalizeSeedSettings 删除）和
 * dsh（升级时 customRemoveFiles 删除旧 dsh）——按 bin.js 存在性判断 runtime 是否就绪。
 *
 * 用户数据红线：只解压 <installDir>/dsh 与 <installDir>/dsh-home-seed（随包内容），
 * 绝不碰 <installDir>/dsh-home（用户数据 / 会话 / 凭据）。
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { basename, dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface ExtractResult {
  /** 本次是否执行了解压 */
  extracted: boolean;
  /** 状态：no-archives（dev 模式）/ already-extracted / extracted */
  reason: string;
}

/** 系统 tar：Win10 1803+ / Win11 自带 bsdtar 3.8+；非 win32 用 PATH 上的 tar。 */
function tarBinary(): string {
  if (process.platform === 'win32') {
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows';
    return join(sysRoot, 'System32', 'tar.exe');
  }
  return 'tar';
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 校验 tgz 的 sha256（随包 .sha256 文件：`<hash>  <name>`）。缺校验文件（dev 模式）不阻塞。 */
function verifySha256(archive: string): void {
  const shaFile = archive + '.sha256';
  if (!existsSync(shaFile)) return;
  const expected = readFileSync(shaFile, 'utf8').split(/\s+/)[0];
  const actual = sha256File(archive);
  if (actual !== expected) {
    throw new Error(`archive checksum mismatch: ${basename(archive)} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
  }
}

/**
 * 解压单个 tgz 到目标目录。Windows bsdtar 会把 `E:\` 绝对路径误解析为"远程主机:路径"
 * （Cannot connect to E:），必须传相对路径（cwd=installDir）+ 正斜杠。
 * 直接解压到目标（不经 staging）：失败残留由幂等判断兜底（bin.js 不在 → 下次重解），
 * 避免 staging + 拷贝的双倍 IO（解压 40s + 拷贝 40s 会顶爆首启预算）。
 */
async function extractTarGz(archive: string, destDir: string, cwd: string): Promise<void> {
  const relArchive = archive.startsWith(cwd) ? archive.slice(cwd.length + 1).replace(/\\/g, '/') : archive;
  const relDest = destDir.startsWith(cwd) ? destDir.slice(cwd.length + 1).replace(/\\/g, '/') : destDir;
  // maxBuffer 兜底：解压 3 万+ 文件时 bsdtar 的警告/进度输出会打爆 execFile 默认 1MB 缓冲
  // （ERR_CHILD_PROCESS_STDIO_MAXBUFFER → 解压异常 → 首启中断）。64MB 覆盖最坏情况。
  await execFileAsync(tarBinary(), ['-xzf', relArchive, '-C', relDest], {
    cwd,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * 首启解压 dsh 运行时 + 种子。调用时机：startShellInner 开头（可写性检测之后、spawn DSH 服务之前）。
 * 异步执行（延续首启无响应修复：同步阻塞主进程会弹"无响应"），窗口保持响应。
 */
export async function extractRuntimes(options: { installDir: string }): Promise<ExtractResult> {
  const archivesDir = join(options.installDir, 'dsh-archives');
  const runtimeArchive = join(archivesDir, 'dsh-runtime.tgz');
  const seedArchive = join(archivesDir, 'dsh-home-seed.tgz');
  const runtimeDest = join(options.installDir, 'dsh', 'node_modules');
  const seedDest = join(options.installDir, 'dsh-home-seed');
  const marker = join(archivesDir, '.extract-complete');
  const ready = join(runtimeDest, '@deepseek-ai', 'dsh', 'lib', 'bin.js');

  if (!existsSync(runtimeArchive) && !existsSync(seedArchive)) {
    return { extracted: false, reason: 'no-archives' }; // dev 模式（未打包归档）
  }
  if (existsSync(marker) && existsSync(ready)) {
    return { extracted: false, reason: 'already-extracted' };
  }
  if (existsSync(runtimeArchive)) {
    verifySha256(runtimeArchive);
    rmSync(runtimeDest, { recursive: true, force: true });
    mkdirSync(runtimeDest, { recursive: true }); // tar -C 目标必须已存在
    await extractTarGz(runtimeArchive, runtimeDest, options.installDir);
  }
  // seed 只在缺失时解压（阶段2 播种完成后会删 dsh-home-seed，重启不需重解）
  if (existsSync(seedArchive) && !existsSync(join(seedDest, 'profiles'))) {
    verifySha256(seedArchive);
    rmSync(seedDest, { recursive: true, force: true });
    mkdirSync(seedDest, { recursive: true });
    await extractTarGz(seedArchive, seedDest, options.installDir);
  }
  writeFileSync(marker, new Date().toISOString(), 'utf8');
  return { extracted: true, reason: 'extracted' };
}
