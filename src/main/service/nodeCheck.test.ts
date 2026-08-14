import { describe, expect, it } from 'vitest';
import { isNodeOk, parseNodeVersion } from './nodeCheck.js';

describe('parseNodeVersion', () => {
  it('parses v-prefixed versions', () => {
    expect(parseNodeVersion('v22.19.0')).toEqual({ major: 22, minor: 19, patch: 0 });
  });

  it('parses without prefix', () => {
    expect(parseNodeVersion('24.1.0')).toEqual({ major: 24, minor: 1, patch: 0 });
  });

  it('returns null for garbage', () => {
    expect(parseNodeVersion('node')).toBeNull();
  });
});

describe('isNodeOk（要求 ^22.19.0 || >=24，调研 A root package.json:9）', () => {
  it('accepts 22.19+', () => {
    expect(isNodeOk('v22.19.0')).toBe(true);
    expect(isNodeOk('v22.20.1')).toBe(true);
  });

  it('rejects 22.18.x', () => {
    expect(isNodeOk('v22.18.0')).toBe(false);
  });

  it('accepts 24+ and above', () => {
    expect(isNodeOk('v24.0.0')).toBe(true);
    expect(isNodeOk('v25.3.0')).toBe(true);
  });

  it('rejects 20.x', () => {
    expect(isNodeOk('v20.19.0')).toBe(false);
  });
});
