import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, ConfigStore, type ShellConfig } from './store.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-desktop-config-'));
}

describe('ConfigStore', () => {
  it('loads defaults when file is missing', () => {
    const dir = tempDir();
    try {
      const store = new ConfigStore(join(dir, 'nested', 'shell-config.json'));
      expect(store.load()).toEqual(DEFAULT_CONFIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips a saved config', () => {
    const dir = tempDir();
    const file = join(dir, 'shell-config.json');
    try {
      const store = new ConfigStore(file);
      const config: ShellConfig = {
        schemaVersion: 1,
        port: 3090,
        window: { width: 1200, height: 800, maximized: false },
        notifications: { result: true },
      };
      store.save(config);
      expect(store.load()).toEqual(config);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns defaults on corrupt JSON (no crash, no throw)', () => {
    const dir = tempDir();
    const file = join(dir, 'shell-config.json');
    try {
      writeFileSync(file, '{ not json', 'utf8');
      expect(new ConfigStore(file).load()).toEqual(DEFAULT_CONFIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns defaults when file content is not an object', () => {
    const dir = tempDir();
    const file = join(dir, 'shell-config.json');
    try {
      writeFileSync(file, '"just a string"', 'utf8');
      expect(new ConfigStore(file).load()).toEqual(DEFAULT_CONFIG);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges partial configs over defaults (forward compatible)', () => {
    const dir = tempDir();
    const file = join(dir, 'shell-config.json');
    try {
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, port: 4000 }), 'utf8');
      const loaded = new ConfigStore(file).load();
      expect(loaded.port).toBe(4000);
      expect(loaded.notifications).toEqual({ result: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips wizard fields (installDir / onboardingDone)', () => {
    const dir = tempDir();
    const file = join(dir, 'shell-config.json');
    try {
      const store = new ConfigStore(file);
      store.save({
        schemaVersion: 1,
        installDir: 'C:\\Apps\\dsh-desktop',
        onboardingDone: true,
      });
      const loaded = store.load();
      expect(loaded.installDir).toBe('C:\\Apps\\dsh-desktop');
      expect(loaded.onboardingDone).toBe(true);
      // 旧配置无这两个字段 → undefined（向导未走）
      writeFileSync(file, JSON.stringify({ schemaVersion: 1 }), 'utf8');
      const fresh = new ConfigStore(file).load();
      expect(fresh.installDir).toBeUndefined();
      expect(fresh.onboardingDone).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists UTF-8 content', () => {
    const dir = tempDir();
    const file = join(dir, 'shell-config.json');
    try {
      const store = new ConfigStore(file);
      store.save({ schemaVersion: 1, port: 3080 });
      expect(readFileSync(file, 'utf8')).toContain('"port"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
