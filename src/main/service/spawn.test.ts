import { describe, expect, it } from 'vitest';
import { buildCommandArgs, buildNodeSpawnSpec, buildSpawnEnv, buildSpawnSpec } from './spawn.js';

describe('buildCommandArgs（启动命令 = 稳定边界 §4.1）', () => {
  it('spawns dsh web with explicit port', () => {
    expect(buildCommandArgs({ port: 3080 })).toEqual(['dsh', 'web', '--port', '3080']);
  });

  it('no --patch（persona 经 home patch cordis.patch.yml 热重载，不传启动参数）', () => {
    expect(buildCommandArgs({ port: 5000 })).toEqual(['dsh', 'web', '--port', '5000']);
  });
});

describe('buildSpawnSpec', () => {
  it('uses dsh by default (PATH 全局 dsh，managed 模式无 checkout)', () => {
    expect(buildSpawnSpec({ port: 3080 })).toEqual({
      command: 'dsh',
      args: ['web', '--port', '3080'],
      shell: process.platform === 'win32',
    });
  });

  it('honors a custom command (e.g. plain dsh on PATH)', () => {
    expect(buildSpawnSpec({ port: 3080, command: 'dsh' })).toEqual({
      command: 'dsh',
      args: ['web', '--port', '3080'],
      shell: process.platform === 'win32',
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
  it('node <dsh入口> web --port <n>，shell:false（kill 才杀得到真进程）', () => {
    expect(
      buildNodeSpawnSpec({ nodeExe: 'C:/rt/node/node.exe', dshEntry: 'C:/d/dsh/lib/bin.js', port: 3080 }),
    ).toEqual({
      command: 'C:/rt/node/node.exe',
      args: ['C:/d/dsh/lib/bin.js', 'web', '--port', '3080'],
      shell: false,
    });
  });
});
