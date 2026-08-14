import { describe, expect, it } from 'vitest';
import { buildCommandArgs, buildNodeSpawnSpec, buildSpawnEnv, buildSpawnSpec } from './spawn.js';

describe('buildCommandArgs（启动命令 = 稳定边界 §4.1）', () => {
  it('spawns dsh web with explicit port', () => {
    expect(buildCommandArgs({ port: 3080 })).toEqual(['dsh', 'web', '--port', '3080']);
  });

  it('passes the desktop patch baseline via --patch when provided (§8.7)', () => {
    expect(buildCommandArgs({ port: 3080, patchFile: 'C:/x/desktop.patch.yml' })).toEqual([
      'dsh',
      'web',
      '--port',
      '3080',
      '--patch',
      'C:/x/desktop.patch.yml',
    ]);
  });

  it('omits --patch when no baseline configured', () => {
    expect(buildCommandArgs({ port: 5000 })).toEqual(['dsh', 'web', '--port', '5000']);
  });
});

describe('buildSpawnSpec', () => {
  it('uses pnpm by default with a deduplicated dsh prefix', () => {
    expect(buildSpawnSpec({ port: 3080 })).toEqual({
      command: 'pnpm',
      args: ['dsh', 'web', '--port', '3080'],
    });
  });

  it('honors a custom command (e.g. plain dsh on PATH)', () => {
    expect(buildSpawnSpec({ port: 3080, command: 'dsh' })).toEqual({
      command: 'dsh',
      args: ['web', '--port', '3080'],
    });
  });

  it('keeps --patch at the tail', () => {
    expect(buildSpawnSpec({ port: 3080, patchFile: 'P.yml', command: 'dsh' })).toEqual({
      command: 'dsh',
      args: ['web', '--port', '3080', '--patch', 'P.yml'],
    });
  });
});

describe('buildSpawnEnv', () => {
  it('keeps the existing environment and only overrides DSH_HOME when provided (FR-22.4)', () => {
    const env = buildSpawnEnv({ dshHome: undefined, base: { PATH: 'x' } });
    expect(env.PATH).toBe('x');
    expect('DSH_HOME' in env).toBe(false);

    const env2 = buildSpawnEnv({ dshHome: 'C:/data/independent', base: { PATH: 'x' } });
    expect(env2.DSH_HOME).toBe('C:/data/independent');
  });
});

describe('buildNodeSpawnSpec（自备 Node 直跑 DSH CLI）', () => {
  it('node <dsh入口> web --port <n>', () => {
    expect(
      buildNodeSpawnSpec({ nodeExe: 'C:/rt/node/node.exe', dshEntry: 'C:/d/dsh/lib/bin.js', port: 3080 }),
    ).toEqual({
      command: 'C:/rt/node/node.exe',
      args: ['C:/d/dsh/lib/bin.js', 'web', '--port', '3080'],
    });
  });

  it('追加 --patch 桌面基线', () => {
    expect(
      buildNodeSpawnSpec({
        nodeExe: 'C:/rt/node/node.exe',
        dshEntry: 'C:/d/dsh/lib/bin.js',
        port: 3080,
        patchFile: 'C:/x/desktop.patch.yml',
      }),
    ).toEqual({
      command: 'C:/rt/node/node.exe',
      args: ['C:/d/dsh/lib/bin.js', 'web', '--port', '3080', '--patch', 'C:/x/desktop.patch.yml'],
    });
  });
});
