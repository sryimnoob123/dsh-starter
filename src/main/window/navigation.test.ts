import { describe, expect, it } from 'vitest';
import { isAllowedNavigationUrl } from './navigation.js';

describe('isAllowedNavigationUrl（窗口导航护栏）', () => {
  it.each(['http://127.0.0.1:3080/', 'http://127.0.0.1:3080/?x=1', 'http://127.0.0.1/'])(
    '允许 DSH 主界面导航 %s',
    (u) => {
      expect(isAllowedNavigationUrl(u)).toBe(true);
    },
  );

  it.each([
    'file:///C:/evil.html',
    'file:///C:/Users/x/Documents/a.pdf',
    'http://localhost:3080/',
    'https://example.com/',
    'about:blank',
    '',
  ])('拒绝会离开壳面的导航 %s', (u) => {
    expect(isAllowedNavigationUrl(u)).toBe(false);
  });
});
