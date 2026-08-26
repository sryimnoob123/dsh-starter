import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractRuntimes } from './extractRuntimes.js';

/** 构造最小可用 tgz（runtime: 含 @deepseek-ai/dsh/lib/bin.js；seed: 含 profiles/）。
 * 注意 bsdtar 在 Windows 把 `C:\` 绝对路径当远程主机（Cannot connect to C:），
 * 构造归档时用 cwd + 相对路径。 */
function makeEnv() {
  const root = join(tmpdir(), `extract-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const installDir = join(root, 'install');
  const archivesDir = join(installDir, 'dsh-archives');
  mkdirSync(archivesDir, { recursive: true });
  const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';
  const makeArchive = (srcDir: string, archiveName: string) => {
    const relSrc = srcDir.slice(root.length + 1).replace(/\\/g, '/');
    const relOut = join('install', 'dsh-archives', archiveName).replace(/\\/g, '/');
    execFileSync(tar, ['-czf', relOut, '-C', relSrc, '.'], { cwd: root });
  };

  // 构造 runtime tgz：内容 = node_modules（bin.js + .bin/dsh.CMD）
  const runtimeSrc = join(root, 'rt-src');
  mkdirSync(join(runtimeSrc, '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  writeFileSync(join(runtimeSrc, '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '// dsh', 'utf8');
  mkdirSync(join(runtimeSrc, '.bin'), { recursive: true });
  writeFileSync(join(runtimeSrc, '.bin', 'dsh.CMD'), '@echo off', 'utf8');
  writeFileSync(join(runtimeSrc, '.modules.yaml'), '{"nodeLinker":"hoisted"}', 'utf8');
  makeArchive(runtimeSrc, 'dsh-runtime.tgz');

  // 构造 seed tgz：内容 = dsh-home-seed（profiles/web/node_modules + settings.yaml）
  const seedSrc = join(root, 'seed-src');
  mkdirSync(join(seedSrc, 'profiles', 'web', 'node_modules'), { recursive: true });
  writeFileSync(join(seedSrc, 'profiles', 'web', 'package.json'), '{"name":"seed"}', 'utf8');
  writeFileSync(join(seedSrc, 'profiles', 'web', 'node_modules', '.modules.yaml'), '{"storeDir":"E:\\\\old"}', 'utf8');
  writeFileSync(join(seedSrc, 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n', 'utf8');
  makeArchive(seedSrc, 'dsh-home-seed.tgz');

  return { installDir, archivesDir };
}

describe('extractRuntimes（tgz 首启解压）', () => {
  it('无归档（dev 模式）→ no-archives 跳过', async () => {
    const installDir = join(tmpdir(), `extract-nodev-${Date.now()}`);
    mkdirSync(installDir, { recursive: true });
    const r = await extractRuntimes({ installDir });
    expect(r).toEqual({ extracted: false, reason: 'no-archives' });
  });

  it('首次解压 runtime + seed 到安装目录', async () => {
    const env = makeEnv();
    const r = await extractRuntimes({ installDir: env.installDir });
    expect(r.extracted).toBe(true);
    // runtime → dsh/node_modules
    expect(existsSync(join(env.installDir, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))).toBe(true);
    expect(existsSync(join(env.installDir, 'dsh', 'node_modules', '.bin', 'dsh.CMD'))).toBe(true);
    // seed → dsh-home-seed
    expect(existsSync(join(env.installDir, 'dsh-home-seed', 'profiles', 'web', 'package.json'))).toBe(true);
    expect(existsSync(join(env.installDir, 'dsh-home-seed', 'settings.yaml'))).toBe(true);
    // 完成标记
    expect(existsSync(join(env.archivesDir, '.extract-complete'))).toBe(true);
  });

  it('已完成 + bin.js 就绪 → already-extracted 跳过（幂等）', async () => {
    const env = makeEnv();
    await extractRuntimes({ installDir: env.installDir });
    const r2 = await extractRuntimes({ installDir: env.installDir });
    expect(r2).toEqual({ extracted: false, reason: 'already-extracted' });
  });

  it('阶段2 删了 dsh-home-seed 后重启 → 不重解（seed 已播种进 dsh-home，终态）', async () => {
    const env = makeEnv();
    await extractRuntimes({ installDir: env.installDir });
    // 模拟 finalizeSeedSettings 删除 dsh-home-seed（阶段2 后），dsh 保留
    rmSync(join(env.installDir, 'dsh-home-seed'), { recursive: true, force: true });
    const r = await extractRuntimes({ installDir: env.installDir });
    // 完成标记 + runtime 就绪 → 跳过（seed 播种已完成，用户数据在 dsh-home，不需要重解）
    expect(r).toEqual({ extracted: false, reason: 'already-extracted' });
    // runtime 保留
    expect(existsSync(join(env.installDir, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))).toBe(true);
  });

  it('种子存在（升级场景 web profile 已有）→ 不覆盖', async () => {
    const env = makeEnv();
    // 预置用户 web profile（升级场景）
    mkdirSync(join(env.installDir, 'dsh-home-seed', 'profiles', 'web'), { recursive: true });
    writeFileSync(join(env.installDir, 'dsh-home-seed', 'profiles', 'web', 'user-data.txt'), 'keep', 'utf8');
    const r = await extractRuntimes({ installDir: env.installDir });
    expect(r.extracted).toBe(true); // runtime 仍解压
    expect(readFileSync(join(env.installDir, 'dsh-home-seed', 'profiles', 'web', 'user-data.txt'), 'utf8')).toBe('keep');
  });

  it('sha256 不匹配 → 抛错（防损坏归档）', async () => {
    const env = makeEnv();
    // 篡改 runtime tgz（破坏校验）
    const archive = join(env.archivesDir, 'dsh-runtime.tgz');
    writeFileSync(join(env.archivesDir, 'dsh-runtime.tgz.sha256'), 'deadbeef'.repeat(8) + '  dsh-runtime.tgz\n', 'utf8');
    await expect(extractRuntimes({ installDir: env.installDir })).rejects.toThrow(/checksum mismatch/);
    // 清掉错误 sha256，让后续正常
    rmSync(join(env.archivesDir, 'dsh-runtime.tgz.sha256'), { force: true });
  });
});
