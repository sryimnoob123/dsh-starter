import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoFixStoreDrift, defaultPnpmStorePath, detectStoreDrift, driveOf, hasForeignDriveLinks, readStoreDir } from './storeDrift.js';

function makeProfile(storeDir: string | null): string {
  const dir = join(tmpdir(), `sd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const nm = join(dir, 'node_modules');
  mkdirSync(nm, { recursive: true });
  if (storeDir !== null) {
    writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir, virtualStoreDir: join(nm, '.pnpm') }), 'utf8');
  }
  return dir;
}

describe('readStoreDir', () => {
  it('有 .modules.yaml → 返回 storeDir', () => {
    const dir = makeProfile('E:\\.pnpm-store\\v11');
    expect(readStoreDir(dir)).toBe('E:\\.pnpm-store\\v11');
    rmSync(dir, { recursive: true, force: true });
  });

  it('无 .modules.yaml → null', () => {
    const dir = makeProfile(null);
    expect(readStoreDir(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('损坏的 .modules.yaml → null', () => {
    const dir = join(tmpdir(), `sd-bad-${Date.now()}`);
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '.modules.yaml'), 'not-json{{{', 'utf8');
    expect(readStoreDir(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('driveOf', () => {
  it('Windows 盘符提取', () => {
    expect(driveOf('E:\\.pnpm-store\\v11')).toBe('E');
    expect(driveOf('D:\\x')).toBe('D');
  });
  it('无盘符 → null', () => {
    expect(driveOf('/x/y')).toBeNull();
    expect(driveOf('')).toBeNull();
  });
});

describe('detectStoreDrift', () => {
  it('storeDir 盘符 ≠ 当前盘符 → 漂移', () => {
    // 当前盘符是 E（本机），构造 D 盘 store → 漂移
    const dir = makeProfile('D:\\.pnpm-store\\v11');
    const r = detectStoreDrift(dir);
    expect(r.drifted).toBe(true);
    expect(r.oldStore).toBe('D:\\.pnpm-store\\v11');
    expect(r.oldDrive).toBe('D');
    rmSync(dir, { recursive: true, force: true });
  });

  it('storeDir 盘符 = profileDir 盘符 → 不漂移', () => {
    const dir = makeProfile('D:\\.pnpm-store\\v11');
    // 把 storeDir 改成 profileDir 所在盘的路径，模拟同盘
    const drive = driveOf(dir);
    if (drive === null) return; // 非 Windows 跳过
    const nm = join(dir, 'node_modules');
    writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: `${drive}:\\same\\store\\v11` }), 'utf8');
    const r = detectStoreDrift(dir);
    expect(r.drifted).toBe(false);
    expect(r.oldDrive).toBe(drive);
    rmSync(dir, { recursive: true, force: true });
  });

  it('无 .modules.yaml → 不漂移', () => {
    const dir = makeProfile(null);
    const r = detectStoreDrift(dir);
    expect(r.drifted).toBe(false);
    expect(r.oldStore).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('hasForeignDriveLinks', () => {
  it('无链接 → false', () => {
    const dir = join(tmpdir(), `sd-nolink-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.js'), 'x', 'utf8');
    expect(hasForeignDriveLinks(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('同盘 junction → false（bundled 插件 junction，与 store 无关，不阻止修复）', () => {
    const dir = join(tmpdir(), `sd-samelink-${Date.now()}`);
    const target = join(tmpdir(), `sd-samelink-target-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    mkdirSync(target, { recursive: true });
    try {
      const cmd = `cmd /c mklink /J "${join(dir, 'junction')}" "${target}"`;
      const { execSync } = require('node:child_process');
      execSync(cmd);
    } catch { return; }
    expect(hasForeignDriveLinks(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });

  it('目录不存在 → true（保守不动）', () => {
    expect(hasForeignDriveLinks(join(tmpdir(), `sd-missing-${Date.now()}`))).toBe(true);
  });
});

describe('autoFixStoreDrift', () => {
  // 用 fake LOCALAPPDATA + config.yaml store-dir 把"目标机默认 store"指到 tmpdir 可控路径，
  // 防止测试在真实 pnpm store（C:\...\Local\pnpm\store\v11）上 mkdir/rm 误伤用户数据。
  function withFakeStore(fn: (fakeStore: string) => void): void {
    const fakeLocal = join(tmpdir(), `sd-local-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fakeStore = join(fakeLocal, 'fake-store', 'v11');
    mkdirSync(join(fakeLocal, 'pnpm', 'config'), { recursive: true });
    writeFileSync(join(fakeLocal, 'pnpm', 'config', 'config.yaml'), `store-dir: ${fakeStore}\n`, 'utf8');
    const old = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = fakeLocal;
    try {
      fn(fakeStore);
    } finally {
      if (old) process.env.LOCALAPPDATA = old;
      rmSync(fakeLocal, { recursive: true, force: true });
    }
  }

  it('storeDir ≠ 目标机默认（打包机盘符残留）→ 改写为盘符相对默认 + 删 virtualStoreDir，返回 true', () => {
    withFakeStore(() => {
      const dir = makeProfile(null);
      const nm = join(dir, 'node_modules');
      writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: 'X:\\old\\store', virtualStoreDir: 'X:\\old\\store\\virtual' }), 'utf8');
      const fixed = autoFixStoreDrift(dir);
      expect(fixed).toBe(true);
      const fixedStore = readStoreDir(dir);
      expect(fixedStore).not.toBe('X:\\old\\store');
      // 改写后的 store 必须是本机 pnpm 在该 profile 目录的实际默认（盘符相对）
      expect(fixedStore).toBe(defaultPnpmStorePath(dir));
      const raw = JSON.parse(readFileSync(join(nm, '.modules.yaml'), 'utf8')) as { virtualStoreDir?: string };
      expect(raw.virtualStoreDir).toBeUndefined();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('改写前备份 .modules.yaml（.dsh-bak）+ 建 store 目录', () => {
    withFakeStore((fakeStore) => {
      const dir = makeProfile(null);
      const nm = join(dir, 'node_modules');
      writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: 'X:\\old\\store', virtualStoreDir: 'X:\\old\\store\\virtual' }), 'utf8');
      const fixed = autoFixStoreDrift(dir);
      expect(fixed).toBe(true);
      // 备份存在且内容为改写前的原始 storeDir
      const bak = readFileSync(join(nm, '.modules.yaml.dsh-bak'), 'utf8');
      expect(JSON.parse(bak)).toMatchObject({ storeDir: 'X:\\old\\store' });
      // store 目录已创建（fake 路径，安全可清理）
      expect(existsSync(fakeStore)).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('备份存在且 storeDir 已修复 → 清备份，返回 false（评审 P1-3）', () => {
    withFakeStore((fakeStore) => {
      const dir = makeProfile(null);
      const nm = join(dir, 'node_modules');
      // storeDir 已是目标默认（用户手动重建过）+ 备份残留 → 应清备份
      writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: fakeStore }), 'utf8');
      writeFileSync(join(nm, '.modules.yaml.dsh-bak'), '{}', 'utf8');
      expect(autoFixStoreDrift(dir)).toBe(false);
      expect(existsSync(join(nm, '.modules.yaml.dsh-bak'))).toBe(false); // 备份已清理
      expect(readStoreDir(dir)).toBe(fakeStore); // storeDir 保留
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('备份存在但 storeDir 仍漂移 → 继续改写（不永久禁修）', () => {
    withFakeStore(() => {
      const dir = makeProfile(null);
      const nm = join(dir, 'node_modules');
      // 备份存在 + storeDir 仍是打包机残留（跨盘 X）→ 应继续修复
      writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: 'X:\\old\\store', virtualStoreDir: 'X:\\old\\virtual' }), 'utf8');
      writeFileSync(join(nm, '.modules.yaml.dsh-bak'), '{}', 'utf8');
      const fixed = autoFixStoreDrift(dir);
      expect(fixed).toBe(true);
      expect(readStoreDir(dir)).toBe(defaultPnpmStorePath(dir));
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('同盘 storeDir ≠ 目标默认（用户自配路径）→ 绝不改写，返回 false（P0-3）', () => {
    withFakeStore(() => {
      const dir = makeProfile(null);
      const nm = join(dir, 'node_modules');
      // 同盘路径（driveOf(dir) 开头）但 ≠ 目标默认 → 用户自配
      const drive = driveOf(dir);
      if (drive === null) return;
      const userStore = `${drive}:\\custom\\user\\store\\v11`;
      writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: userStore }), 'utf8');
      const fixed = autoFixStoreDrift(dir);
      expect(fixed).toBe(false);
      expect(readStoreDir(dir)).toBe(userStore); // 用户配置原样保留
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('同盘自配 storeDir + virtualStoreDir 残留 → 只删 virtual，不动 storeDir', () => {
    withFakeStore(() => {
      const dir = makeProfile(null);
      const nm = join(dir, 'node_modules');
      const drive = driveOf(dir);
      if (drive === null) return;
      const userPath = `${drive}\\my\\store\\v11`;
      writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: userPath, virtualStoreDir: 'X:\\old\\virtual' }), 'utf8');
      const fixed = autoFixStoreDrift(dir);
      expect(fixed).toBe(true);
      expect(readStoreDir(dir)).toBe(userPath); // 用户自配 storeDir 不被改写
      const raw = JSON.parse(readFileSync(join(nm, '.modules.yaml'), 'utf8')) as { virtualStoreDir?: string };
      expect(raw.virtualStoreDir).toBeUndefined(); // 仅清 virtual 残留
      expect(existsSync(join(nm, '.modules.yaml.dsh-bak'))).toBe(false); // 未触发改写备份
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('storeDir = 目标机 pnpm 默认 → 不动，返回 false', () => {
    const dir = makeProfile(null);
    const nm = join(dir, 'node_modules');
    const defaultStore = defaultPnpmStorePath(dir);
    if (!defaultStore) return;
    writeFileSync(join(nm, '.modules.yaml'), JSON.stringify({ storeDir: defaultStore }), 'utf8');
    const fixed = autoFixStoreDrift(dir);
    expect(fixed).toBe(false);
    expect(readStoreDir(dir)).toBe(defaultStore); // 字段保留
    rmSync(dir, { recursive: true, force: true });
  });

  it('无 .modules.yaml → false', () => {
    const dir = makeProfile(null);
    expect(autoFixStoreDrift(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('defaultPnpmStorePath（复刻 pnpm 盘符相对算法）', () => {
  it('profile 与 pnpm home 同盘（本机 C）→ LOCALAPPDATA\\pnpm\\store\\v11', () => {
    const local = process.env.LOCALAPPDATA;
    if (!local) return;
    const dir = join(local, 'pnpm', 'store', 'v11');
    // 用真实 LOCALAPPDATA 目录作为 profileDir 的近似（同盘）
    expect(defaultPnpmStorePath(local)).toBe(dir);
  });

  it('profile 与 pnpm home 跨盘（模拟 E 盘 profile）→ E:\\.pnpm-store\\v11', () => {
    const local = process.env.LOCALAPPDATA;
    if (!local) return;
    const eProfile = join('E:', 'x', 'dsh-home', 'profiles', 'web');
    const expected = 'E:\\.pnpm-store\\v11';
    expect(defaultPnpmStorePath(eProfile)).toBe(expected);
  });

  it('config.yaml 显式 store-dir → 用该值', () => {
    const local = process.env.LOCALAPPDATA;
    if (!local) return;
    // 构造临时 LOCALAPPDATA 模拟 config.yaml（临时目录）
    const fakeLocal = join(tmpdir(), `sd-cfg-${Date.now()}`);
    mkdirSync(join(fakeLocal, 'pnpm', 'config'), { recursive: true });
    writeFileSync(join(fakeLocal, 'pnpm', 'config', 'config.yaml'), 'store-dir: D:\\mystore\\v11\n', 'utf8');
    const old = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = fakeLocal;
    try {
      expect(defaultPnpmStorePath('C:\\x')).toBe('D:\\mystore\\v11');
    } finally {
      if (old) process.env.LOCALAPPDATA = old;
      rmSync(fakeLocal, { recursive: true, force: true });
    }
  });

  it('config.yaml 显式 storeDir（pnpm 11 camelCase）→ 用该值（评审 P1-1）', () => {
    const fakeLocal = join(tmpdir(), `sd-cfg-camel-${Date.now()}`);
    mkdirSync(join(fakeLocal, 'pnpm', 'config'), { recursive: true });
    writeFileSync(join(fakeLocal, 'pnpm', 'config', 'config.yaml'), 'storeDir: D:\\mystore\\v11\n', 'utf8');
    const old = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = fakeLocal;
    try {
      expect(defaultPnpmStorePath('C:\\x')).toBe('D:\\mystore\\v11');
    } finally {
      if (old) process.env.LOCALAPPDATA = old;
      rmSync(fakeLocal, { recursive: true, force: true });
    }
  });

  it('用户级 .npmrc 的 store-dir → 用该值（评审 P1-2）', () => {
    const fakeHome = join(tmpdir(), `sd-npmrc-${Date.now()}`);
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(join(fakeHome, '.npmrc'), 'store-dir=D:\\npminrc-store\\v11\n', 'utf8');
    const old = process.env.USERPROFILE;
    process.env.USERPROFILE = fakeHome;
    const oldLocal = process.env.LOCALAPPDATA;
    const fakeLocal = join(tmpdir(), `sd-npmrc-local-${Date.now()}`);
    process.env.LOCALAPPDATA = fakeLocal; // 空 LOCALAPPDATA → 无 config.yaml
    try {
      expect(defaultPnpmStorePath('C:\\x')).toBe('D:\\npminrc-store\\v11');
    } finally {
      if (old) process.env.USERPROFILE = old;
      if (oldLocal) process.env.LOCALAPPDATA = oldLocal;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it('非 Windows → null', () => {
    const oldPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(defaultPnpmStorePath('C:\\x')).toBeNull();
    } finally {
      if (oldPlatform) Object.defineProperty(process, 'platform', oldPlatform);
    }
  });
});
