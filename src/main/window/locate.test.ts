import { describe, expect, it } from 'vitest';
import { buildLocateSessionScript, isDshAppUrl, SESSION_STORAGE_KEY } from './locate.js';

describe('isDshAppUrl', () => {
  it('accepts the DSH main UI served on 127.0.0.1 with any port', () => {
    expect(isDshAppUrl('http://127.0.0.1:3080/')).toBe(true);
    expect(isDshAppUrl('http://127.0.0.1:3080/?x=1')).toBe(true);
    expect(isDshAppUrl('http://127.0.0.1/')).toBe(true);
  });

  it('rejects shell local pages and non-DSH origins', () => {
    expect(isDshAppUrl('file:///C:/app/resources/app.asar/dist/main/pages/install-wizard.html')).toBe(false);
    expect(isDshAppUrl('http://localhost:3080/')).toBe(false);
    expect(isDshAppUrl('https://example.com/')).toBe(false);
    expect(isDshAppUrl('')).toBe(false);
  });
});

describe('buildLocateSessionScript', () => {
  it('writes the documented dsh.sessions.current payload and reloads', () => {
    expect(buildLocateSessionScript('s1')).toBe(
      `localStorage.setItem("dsh.sessions.current", "{\\"sessionId\\":\\"s1\\"}"); location.reload();`,
    );
  });

  it('produces a runnable script that round-trips the session id', () => {
    const writes: Array<[string, string]> = [];
    let reloaded = false;
    const script = buildLocateSessionScript('session-ee30816e');
    // 脚本只依赖 localStorage.setItem 与 location.reload，按真实页面环境跑一遍
    const fn = new Function(
      'localStorage',
      'location',
      script,
    ) as (ls: { setItem(k: string, v: string): void }, loc: { reload(): void }) => void;
    fn(
      { setItem: (k: string, v: string) => void writes.push([k, v]) },
      { reload: () => void (reloaded = true) },
    );
    expect(writes).toEqual([[SESSION_STORAGE_KEY, '{"sessionId":"session-ee30816e"}']]);
    expect(reloaded).toBe(true);
  });

  it('escapes quotes inside the session id safely', () => {
    const script = buildLocateSessionScript('a"b\\c');
    const writes: Array<[string, string]> = [];
    const fn = new Function('localStorage', 'location', script) as (ls: {
      setItem(k: string, v: string): void;
    }, loc: { reload(): void }) => void;
    fn({ setItem: (k: string, v: string) => void writes.push([k, v]) }, { reload: () => undefined });
    expect(writes[0]).toEqual([SESSION_STORAGE_KEY, JSON.stringify({ sessionId: 'a"b\\c' })]);
  });
});
