/**
 * 通知点击 → 定位会话（打磨项，2026-08-15）。
 * DSH Web 应用启动时从 localStorage `dsh.sessions.current`（JSON `{sessionId}`）恢复会话，
 * 且 `workspaces.startInitialSelection` 明确"已恢复的当前会话优先"（DSH 客户端源码与
 * startup-auto-selection e2e 均锁定该契约）。壳不发明新 RPC：写入该键 + reload 页面，
 * DSH 加载即切换到目标会话——走 DSH 稳定边界（架构文档 §4）。
 */

export const SESSION_STORAGE_KEY = 'dsh.sessions.current';

/** 当前页面是否为 DSH 主界面（壳本地页都是 file://，主界面 = http://127.0.0.1:<port>） */
export function isDshAppUrl(url: string): boolean {
  return /^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url);
}

/** 生成"写入会话选择并刷新"的脚本；DSH 加载时按 dsh.sessions.current 恢复目标会话 */
export function buildLocateSessionScript(sessionId: string): string {
  const value = JSON.stringify(JSON.stringify({ sessionId }));
  return `localStorage.setItem(${JSON.stringify(SESSION_STORAGE_KEY)}, ${value}); location.reload();`;
}
