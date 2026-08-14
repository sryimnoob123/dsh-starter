/**
 * 断线补偿（架构文档 §4.4 "重连即对齐"，[FR-4.1] 不因断线丢事件）：
 * 重连后以 session/jobs 快照与断连前最后已知状态 diff，
 * 断连期间新进入终态的 job → 补发通知；按 sessionId+jobId 幂等去重。
 */

export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

export interface JobSnapshot {
  sessionId: string;
  jobs: Array<{ id: string; status: JobStatus }>;
}

export interface TerminalJob {
  sessionId: string;
  jobId: string;
  status: JobStatus;
}

const TERMINAL: readonly JobStatus[] = ['completed', 'killed', 'failed'];

export function diffJobs(
  prev: Map<string, JobStatus>,
  next: JobSnapshot,
): TerminalJob[] {
  const emitted: TerminalJob[] = [];
  for (const job of next.jobs) {
    const key = `${next.sessionId}:${job.id}`;
    const before = prev.get(key);
    if (before !== job.status && TERMINAL.includes(job.status)) {
      emitted.push({ sessionId: next.sessionId, jobId: job.id, status: job.status });
    }
    prev.set(key, job.status);
  }
  return emitted;
}
