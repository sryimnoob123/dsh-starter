/**
 * 事件 → 通知分类（架构文档 §4.4/§8.2，[FR-4.1] 简单策略）：
 * V1 只有一个通知类型 `result`（"有结果就通知"），类型开关走注册表 enabled 字段。
 * 触发源：session/jobs 终态、host/agent-error、approval/question requested。
 */

export interface JobView {
  id: string;
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
}

export type MuxFrame =
  | { type: 'session/jobs'; sessionId: string; jobs: JobView[] }
  | { type: 'host/agent-error'; sessionId: string; message?: string }
  | { type: 'approval/requested'; sessionId: string }
  | { type: 'question/requested'; sessionId: string }
  | { type: 'session/subscribed'; sessionId: string; lastSeq: number }
  | { type: 'stream/error'; error: unknown };

export interface NotificationCandidate {
  type: 'result';
  sessionId: string;
  title: string;
}

const TERMINAL = new Set(['completed', 'killed', 'failed']);

export function classifyEvent(frame: MuxFrame): NotificationCandidate | null {
  switch (frame.type) {
    case 'session/jobs': {
      const terminal = frame.jobs.find((j) => TERMINAL.has(j.status));
      if (!terminal) return null;
      const title = terminal.status === 'failed' || terminal.status === 'killed' ? '任务失败' : '任务完成';
      return { type: 'result', sessionId: frame.sessionId, title };
    }
    case 'host/agent-error':
      return { type: 'result', sessionId: frame.sessionId, title: '出错了' };
    case 'approval/requested':
    case 'question/requested':
      return { type: 'result', sessionId: frame.sessionId, title: '等待确认' };
    default:
      return null;
  }
}
