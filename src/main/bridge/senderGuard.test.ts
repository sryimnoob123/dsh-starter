/**
 * senderGuard 回归测试：
 * - 2026-08-26 实锤 bug：4.8 把 windowControl/checkForUpdates 划进 LOCAL_PAGE_ONLY_METHODS，
 *   但右上角悬浮按钮（FLOATING_CONTROLS_SCRIPT）运行在 DSH 页面（http://127.0.0.1:3080/），
 *   点按钮 → IPC 被拒 → 按钮点了没反应（4.8 真实用户反馈）。
 * - 修复：windowControl/checkForUpdates 挪进 DSH_PAGE_ALLOWED_METHODS。
 */
import { describe, expect, it } from 'vitest';
import {
  checkIpcCall,
  DSH_PAGE_ALLOWED_METHODS,
  LOCAL_PAGE_ONLY_METHODS,
  registerTrustedSender,
} from './senderGuard.js';

/** 伪造 WebContents：只带 sender 校验需要的 id/getURL。 */
function makeSender(id: number, url: string): Electron.WebContents {
  return { id, getURL: () => url } as unknown as Electron.WebContents;
}

describe('senderGuard IPC sender 校验', () => {
  it('可信 DSH 页面可调 windowControl（悬浮按钮最小化/最大化/关闭）', () => {
    registerTrustedSender(1);
    const sender = makeSender(1, 'http://127.0.0.1:3080/');
    expect(checkIpcCall('windowControl', sender)).toBeNull();
  });

  it('可信 DSH 页面可调 checkForUpdates（悬浮按钮更新入口）', () => {
    registerTrustedSender(1);
    const sender = makeSender(1, 'http://127.0.0.1:3080/');
    expect(checkIpcCall('checkForUpdates', sender)).toBeNull();
  });

  it('DSH 页面调高敏感方法（quit/startInstall）仍被拒', () => {
    registerTrustedSender(1);
    const sender = makeSender(1, 'http://127.0.0.1:3080/');
    for (const m of ['quit', 'startInstall', 'pickDir', 'savePromptSettings']) {
      expect(checkIpcCall(m, sender)).not.toBeNull();
    }
  });

  it('未注册 sender 一律拒绝（含 DSH 页面）', () => {
    const sender = makeSender(999, 'http://127.0.0.1:3080/');
    expect(checkIpcCall('windowControl', sender)).toMatch(/untrusted sender/);
  });

  it('壳本地页放行一切方法（含 windowControl）', () => {
    registerTrustedSender(2);
    const sender = makeSender(2, 'file:///C:/pages/settings.html');
    expect(checkIpcCall('windowControl', sender)).toBeNull();
    expect(checkIpcCall('savePromptSettings', sender)).toBeNull();
  });

  it('非本机页被拒绝', () => {
    registerTrustedSender(3);
    const sender = makeSender(3, 'https://evil.example/x');
    expect(checkIpcCall('pluginList', sender)).toMatch(/untrusted page url/);
  });
});
