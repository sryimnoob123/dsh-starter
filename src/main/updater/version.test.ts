import { describe, expect, it } from 'vitest';
import { needsUpdate, parseSemver } from './version.js';

describe('parseSemver', () => {
  it('parses plain semver', () => {
    expect(parseSemver('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseSemver('43.4.0')).toEqual({ major: 43, minor: 4, patch: 0 });
  });

  it('handles v-prefix and prerelease suffix', () => {
    expect(parseSemver('v1.2.3-beta')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('returns null for garbage', () => {
    expect(parseSemver('latest')).toBeNull();
  });
});

describe('needsUpdate（[D78] 自动检查更新）', () => {
  it('true when latest is newer (patch/minor/major)', () => {
    expect(needsUpdate('0.1.0', '0.1.1')).toBe(true);
    expect(needsUpdate('0.1.9', '0.2.0')).toBe(true);
    expect(needsUpdate('0.9.9', '1.0.0')).toBe(true);
  });

  it('false when same or older', () => {
    expect(needsUpdate('0.1.1', '0.1.1')).toBe(false);
    expect(needsUpdate('0.2.0', '0.1.9')).toBe(false);
  });

  it('false when either side is unparseable (never auto-install garbage)', () => {
    expect(needsUpdate('dev', '1.0.0')).toBe(false);
    expect(needsUpdate('0.1.0', 'latest')).toBe(false);
  });
});
