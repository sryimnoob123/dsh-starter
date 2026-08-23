/**
 * 快捷键体系（[整合包调研] 高优先级差距项）：竞品全部标配（LobeHub ⌘K/Alt+R、OpenCode leader-key、Codex 斜杠）。
 * 落地形态（最小够用、不抢系统键）：
 * - 全局 1 个：Ctrl+Shift+Space 呼出/聚焦窗口（globalShortcut）；
 * - 应用内 4 个（before-input-event，仅壳窗口聚焦时生效）：压缩上下文 / 修复 / 备份 / 查看日志。
 * 纯判定函数可测；注册函数由 app.ts 调用。
 */

export type ShortcutAction = 'toggle-window' | 'compact' | 'repair' | 'backup' | 'logs';

/** 组合键判定（Electron before-input-event 的 input 对象；只认 Ctrl/Command + Shift + 字母，避免抢系统键） */
export function matchShortcut(
  input: { key?: string; control?: boolean; meta?: boolean; shift?: boolean; alt?: boolean },
): ShortcutAction | null {
  if (!input || typeof input.key !== 'string') return null;
  // 只响应"主修饰键（Ctrl 或 Meta=Command）+ Shift + 字母"；纯字母/其他组合不碰（让 DSH 页面自己处理）
  const primary = input.control || input.meta;
  if (!primary || !input.shift || input.alt) return null;
  const key = input.key.toLowerCase();
  if (key === 'c') return 'compact';
  if (key === 'f') return 'repair';
  if (key === 'b') return 'backup';
  if (key === 'l') return 'logs';
  return null;
}

/** 全局呼出键（Electron globalShortcut 字符串；跨平台用 CommandOrControl） */
export const GLOBAL_TOGGLE_SHORTCUT = 'CommandOrControl+Shift+Space';

/** 判定 globalShortcut 注册结果的包（可测试） */
export function describeShortcutRegistration(ok: boolean, shortcut: string): string {
  return ok
    ? `shortcut registered: ${shortcut}`
    : `shortcut registration failed (可能被其他应用占用): ${shortcut}`;
}
