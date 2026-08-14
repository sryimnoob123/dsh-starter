import { describe, expect, it } from 'vitest';
import { classifyStartupFailure, type StartupContext } from './guidance.js';

describe('classifyStartupFailure（引导页错误状态分类，§3.4，[FR-21.3]）', () => {
  const ok: StartupContext = {
    nodeOk: true,
    dshDetected: true,
    probe: 'free',
    spawnExitCode: null,
  };

  it('port occupied by a foreign service → port guidance', () => {
    expect(classifyStartupFailure({ ...ok, probe: 'occupied' })).toEqual({
      page: 'service-not-running',
      guidance: 'port-occupied',
    });
  });

  it('Node below requirement → node guidance', () => {
    expect(classifyStartupFailure({ ...ok, nodeOk: false })).toEqual({
      page: 'service-not-running',
      guidance: 'node-missing',
    });
  });

  it('DSH not installed → install wizard', () => {
    expect(classifyStartupFailure({ ...ok, dshDetected: false })).toEqual({
      page: 'install-wizard',
      guidance: 'dsh-missing',
    });
  });

  it('service crashed right after spawn → crash guidance with exit code', () => {
    expect(classifyStartupFailure({ ...ok, spawnExitCode: 1 })).toEqual({
      page: 'service-not-running',
      guidance: 'spawn-crash',
    });
  });

  it('config/homedir broken → reset guidance', () => {
    expect(classifyStartupFailure({ ...ok, configBroken: true })).toEqual({
      page: 'service-not-running',
      guidance: 'config-broken',
    });
  });

  it('everything fine → null (normal state)', () => {
    expect(classifyStartupFailure(ok)).toBeNull();
  });
});
