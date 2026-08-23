import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedProfileFromBundled, finalizeSeedSettings } from './seedProfile.js';

function makeEnv() {
  const root = join(tmpdir(), `seed-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const installDir = join(root, 'install');
  // 构造包内种子
  const seedWeb = join(installDir, 'dsh-home-seed', 'profiles', 'web');
  mkdirSync(join(seedWeb, 'node_modules', 'dshmarket'), { recursive: true });
  writeFileSync(join(seedWeb, 'package.json'), '{"name":"dsh-profile-web","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}', 'utf8');
  writeFileSync(join(seedWeb, 'node_modules', 'dshmarket', 'index.js'), 'module.exports=1', 'utf8');
  return { installDir, seedWeb };
}

describe('阶段1 seedProfileFromBundled（spawn 前：web profile 拷贝）', () => {
  it('无种子目录（开发模式）→ 跳过，不报错', () => {
    const installDir = join(tmpdir(), `seed-noseed-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'install');
    mkdirSync(installDir, { recursive: true });
    const r = seedProfileFromBundled({ installDir });
    expect(r).toEqual({ seeded: false, reason: 'no-bundled-seed' });
  });

  it('dsh-home 无 web profile → 从种子整体拷贝', () => {
    const env = makeEnv();
    const r = seedProfileFromBundled({ installDir: env.installDir });
    expect(r.seeded).toBe(true);
    expect(r.reason).toBe('seeded-from-bundle');
    const target = join(env.installDir, 'dsh-home', 'profiles', 'web');
    expect(existsSync(join(target, 'package.json'))).toBe(true);
    expect(existsSync(join(target, 'node_modules', 'dshmarket', 'index.js'))).toBe(true);
  });

  it('已存在 web profile（用户数据）→ 绝不覆盖', () => {
    const env = makeEnv();
    // 先播种一次
    seedProfileFromBundled({ installDir: env.installDir });
    // 用户改动了 package.json（模拟用户数据）
    const target = join(env.installDir, 'dsh-home', 'profiles', 'web');
    writeFileSync(join(target, 'package.json'), '{"name":"user-modified"}', 'utf8');
    // 重建种子目录（阶段1已拷完但未删——终态清理在阶段2）
    const seedWeb = join(env.installDir, 'dsh-home-seed', 'profiles', 'web');
    mkdirSync(join(seedWeb, 'node_modules', 'dshmarket'), { recursive: true });
    writeFileSync(join(seedWeb, 'package.json'), '{"name":"seed"}', 'utf8');
    writeFileSync(join(seedWeb, 'node_modules', 'dshmarket', 'index.js'), 'module.exports=1', 'utf8');
    // 再跑播种 → 不动
    const r = seedProfileFromBundled({ installDir: env.installDir });
    expect(r).toEqual({ seeded: false, reason: 'profile-exists' });
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('user-modified');
  });

  it('阶段1不删 dsh-home-seed（settings 留给阶段2）', () => {
    const env = makeEnv();
    seedProfileFromBundled({ installDir: env.installDir });
    expect(existsSync(join(env.installDir, 'dsh-home-seed'))).toBe(true);
  });
});

describe('阶段2 finalizeSeedSettings（service ready 后：settings 补种 + 清理）', () => {
  it('settings 缺失 → 补种子的完整配置', () => {
    const env = makeEnv();
    writeFileSync(join(env.installDir, 'dsh-home-seed', 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n', 'utf8');
    seedProfileFromBundled({ installDir: env.installDir });
    const r = finalizeSeedSettings({ installDir: env.installDir });
    expect(r.applied).toBe(true);
    expect(r.reason).toBe('settings-seeded');
    expect(readFileSync(join(env.installDir, 'dsh-home', 'settings.yaml'), 'utf8')).toContain('danger-full-access');
  });

  it('用户 settings 是 DSH 空壳（仅 permission）→ 补种子的完整配置', () => {
    const env = makeEnv();
    writeFileSync(join(env.installDir, 'dsh-home-seed', 'settings.yaml'), 'desktop-background:\n  enabled: true\nllm-pi-ai:\n  providers:\n    ollama:\n      apiKeyEnv: OLLAMA_API_KEY\n', 'utf8');
    // DSH 初始化的空壳（只有 permission 默认段，48B）
    mkdirSync(join(env.installDir, 'dsh-home'), { recursive: true });
    writeFileSync(join(env.installDir, 'dsh-home', 'settings.yaml'), 'permission:\n  defaultPreset: danger-full-access\n', 'utf8');
    const r = finalizeSeedSettings({ installDir: env.installDir });
    expect(r.applied).toBe(true);
    expect(readFileSync(join(env.installDir, 'dsh-home', 'settings.yaml'), 'utf8')).toContain('desktop-background');
  });

  it('用户 settings 有实质内容 → 绝不动', () => {
    const env = makeEnv();
    writeFileSync(join(env.installDir, 'dsh-home-seed', 'settings.yaml'), 'desktop-background:\n  enabled: true\n', 'utf8');
    mkdirSync(join(env.installDir, 'dsh-home'), { recursive: true });
    writeFileSync(join(env.installDir, 'dsh-home', 'settings.yaml'), 'desktop-background:\n  color: red\nui-theme:\n  preference: dark\n', 'utf8');
    const r = finalizeSeedSettings({ installDir: env.installDir });
    expect(r.applied).toBe(false);
    expect(readFileSync(join(env.installDir, 'dsh-home', 'settings.yaml'), 'utf8')).toContain('color: red');
  });

  it('阶段2后清理 dsh-home-seed 残留（终态只留 exe+dsh+dsh-home）', () => {
    const env = makeEnv();
    seedProfileFromBundled({ installDir: env.installDir });
    finalizeSeedSettings({ installDir: env.installDir });
    expect(existsSync(join(env.installDir, 'dsh-home-seed'))).toBe(false);
  });
});
