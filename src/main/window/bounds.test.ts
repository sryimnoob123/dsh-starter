import { describe, expect, it } from 'vitest';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  normalizeWindowBounds,
  type WindowBounds,
} from './bounds.js';

const FALLBACK: WindowBounds = { width: 1280, height: 800, maximized: false };

describe('normalizeWindowBounds', () => {
  it('非对象输入回默认', () => {
    for (const raw of [undefined, null, 'x', 7, true, []]) {
      expect(normalizeWindowBounds(raw, FALLBACK)).toEqual(FALLBACK);
    }
  });

  it('合法值原样保留并取整', () => {
    expect(normalizeWindowBounds({ width: 1024.6, height: 700, maximized: true }, FALLBACK)).toEqual({
      width: 1025,
      height: 700,
      maximized: true,
    });
    expect(normalizeWindowBounds({ width: 400, height: 300, maximized: false }, FALLBACK)).toEqual({
      width: 400,
      height: 300,
      maximized: false,
    });
  });

  it.each([
    { width: MIN_WIDTH - 1, height: 800 },
    { width: 1280, height: MIN_HEIGHT - 1 },
    { width: 100_001, height: 800 },
    { width: 1280, height: 99_999 },
    { width: NaN, height: 800 },
    { width: 1280, height: Infinity },
    { width: '1024', height: 800 },
    { width: 1280, height: undefined },
  ])('越界/非法尺寸单项回默认 %o', (bad) => {
    const out = normalizeWindowBounds({ ...bad, maximized: true }, FALLBACK);
    expect(out.maximized).toBe(true); // 布尔字段不受尺寸影响
    if (typeof bad.width === 'number' && bad.width >= MIN_WIDTH && bad.width <= 10000) {
      expect(out.width).toBe(Math.round(bad.width));
      expect(out.height).toBe(FALLBACK.height);
    } else if (typeof bad.height === 'number' && bad.height >= MIN_HEIGHT && bad.height <= 10000) {
      expect(out.height).toBe(Math.round(bad.height));
      expect(out.width).toBe(FALLBACK.width);
    }
  });

  it('maximized 非布尔回默认', () => {
    expect(normalizeWindowBounds({ width: 900, height: 600, maximized: 'yes' }, FALLBACK)).toEqual({
      width: 900,
      height: 600,
      maximized: false,
    });
  });
});
