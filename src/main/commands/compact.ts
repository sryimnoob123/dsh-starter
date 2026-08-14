/**
 * FR-27 常用指令入口（V1）：托盘"压缩上下文"一键操作。
 *
 * 稳定边界（DSH 官方行为，packages/host/apiproxy/src/api/sessions.ts）：
 * `session.prompt` 的内容恰为一个以 `/` 开头的文本块时，宿主把它当斜杠命令
 * 交给命令注册表执行、不进模型轮次；`/compact` 由 web 组合的 command-compact
 * 插件注册（空闲时执行，忙时报 command-error）。当前会话 id 从页面
 * localStorage `dsh.sessions.current`（JSON {sessionId}）读取——与通知定位
 * 会话同一契约（window/locate.ts）。
 */

export const COMPACT_COMMAND_TEXT = '/compact';

/** 单文本块内容：DSH 判定为斜杠命令的充要形状 */
export function buildCompactPromptContent(): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: COMPACT_COMMAND_TEXT }];
}

/** session.prompt 载荷（queue 模式；压缩不排队、busy 时报错——命令自身语义） */
export function buildCompactPayload(sessionId: string): {
  sessionId: string;
  mode: 'queue';
  content: Array<{ type: 'text'; text: string }>;
} {
  return { sessionId, mode: 'queue', content: buildCompactPromptContent() };
}

/** 从 dsh.sessions.current 原始存储值解析当前会话 id；损坏/缺失 → null */
export function parseCurrentSessionId(stored: string | null): string | null {
  if (typeof stored !== 'string' || stored.trim() === '') return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const id = (parsed as Record<string, unknown>).sessionId;
      if (typeof id === 'string' && id.trim() !== '') return id;
    }
  } catch {
    // 损坏的存储值 = 无当前会话
  }
  return null;
}

/** 提取 session.prompt 响应里的命令反馈文本（command.success.text） */
export function describeCompactFeedback(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const command = (raw as Record<string, unknown>).command;
  if (typeof command !== 'object' || command === null) return null;
  const c = command as Record<string, unknown>;
  if (c.kind === 'success' && typeof c.text === 'string') return c.text;
  return null;
}
