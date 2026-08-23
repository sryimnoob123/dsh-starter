import { describe, expect, it } from 'vitest';
import {
  extractReleaseNotes,
  needsUpdate,
  parseSemver,
  sanitizeReleaseNotesHtml,
  shouldInstallUpdate,
  shouldSuppressPopup,
} from './version.js';

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

describe('shouldInstallUpdate（[B1] 安装幂等 / 版本守卫）', () => {
  it('true when pending is newer than current', () => {
    expect(shouldInstallUpdate('0.1.0', '0.1.1')).toBe(true);
    expect(shouldInstallUpdate('0.1.9', '0.2.0')).toBe(true);
  });

  it('false when pending is same or older (already installed / not newer)', () => {
    expect(shouldInstallUpdate('0.1.1', '0.1.1')).toBe(false);
    expect(shouldInstallUpdate('0.2.0', '0.1.9')).toBe(false);
  });

  it('false when either side is unparseable (never install garbage)', () => {
    expect(shouldInstallUpdate('dev', '1.0.0')).toBe(false);
    expect(shouldInstallUpdate('0.1.0', 'latest')).toBe(false);
  });
});

describe('extractReleaseNotes（[更新日志] 从 UpdateInfo.releaseNotes 提取可渲染 HTML）', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(extractReleaseNotes(null)).toBe('');
    expect(extractReleaseNotes(undefined)).toBe('');
    expect(extractReleaseNotes('')).toBe('');
  });

  it('passes through a plain string note', () => {
    expect(extractReleaseNotes('<p>修复了崩溃</p>')).toBe('<p>修复了崩溃</p>');
  });

  it('joins array notes newest-first (provider already sorts)', () => {
    const notes = [
      { version: '0.2.0', note: '<p>新增功能</p>' },
      { version: '0.1.1', note: '<p>修复 bug</p>' },
    ];
    expect(extractReleaseNotes(notes)).toBe('<p>新增功能</p>\n<p>修复 bug</p>');
  });

  it('strips script tags (trust boundary: release body from own feed)', () => {
    expect(extractReleaseNotes('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });
});

describe('sanitizeReleaseNotesHtml（[审查 M4] 纵深防御）', () => {
  it('剥 iframe/object/embed 标签（不只看 script）', () => {
    expect(sanitizeReleaseNotesHtml('<p>a</p><iframe src="https://x"></iframe>')).toBe('<p>a</p>');
    expect(sanitizeReleaseNotesHtml('<object data="x"></object><embed src="y">')).toBe('');
  });

  it('剥事件属性（onclick 等）', () => {
    expect(sanitizeReleaseNotesHtml('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>');
    expect(sanitizeReleaseNotesHtml('<img src="a.png" onerror="alert(1)">')).toBe('<img src="a.png">');
  });

  it('剥 javascript: URL（href/src）', () => {
    expect(sanitizeReleaseNotesHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
  });

  it('剥无引号 javascript:/vbscript:/data: URL + style 属性（防绕过）', () => {
    expect(sanitizeReleaseNotesHtml('<a href=javascript:alert(1)>x</a>')).toBe('<a href="#">x</a>');
    expect(sanitizeReleaseNotesHtml('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(sanitizeReleaseNotesHtml('<a href="data:text/html;base64,x">x</a>')).toBe('<a href="#">x</a>');
    expect(sanitizeReleaseNotesHtml('<p style="background:url(javascript:x)">x</p>')).toBe('<p>x</p>');
  });

  it('剥 style/link/meta/base/math 标签', () => {
    expect(sanitizeReleaseNotesHtml('<style>@import url(x)</style><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeReleaseNotesHtml('<link rel="stylesheet" href="x"><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeReleaseNotesHtml('<math><mtext>x</mtext></math>')).toBe('');
  });
});

describe('shouldSuppressPopup（[稍后持久化] 同版本不再弹，新版本恢复）', () => {
  it('suppresses when dismissed version matches incoming', () => {
    expect(shouldSuppressPopup('0.5.0', '0.5.0')).toBe(true);
  });

  it('does not suppress when dismissed version differs (new version arrives)', () => {
    expect(shouldSuppressPopup('0.5.0', '0.6.0')).toBe(false);
  });

  it('does not suppress when nothing dismissed yet', () => {
    expect(shouldSuppressPopup(null, '0.5.0')).toBe(false);
    expect(shouldSuppressPopup(undefined, '0.5.0')).toBe(false);
    expect(shouldSuppressPopup('', '0.5.0')).toBe(false);
  });
});
