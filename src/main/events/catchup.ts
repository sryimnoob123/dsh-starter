/**
 * 断线补偿（架构文档 §4.4 "重连即对齐"，[FR-4.1] 不因断线丢事件）：
 * 重连后以 session/jobs 快照与断连前最后已知状态 diff。
 * 只通知"壳亲眼见过其运行态、之后进入终态"的 job——
 * 首次连接/重连时的基线回放里早已终态的 job 不补发（否则历史任务海啸式弹通知）。
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
    // before === undefined = 首次见（基线回放）：只记录不通知；
    // 见过运行态后转终态 = 真完成 → 通知
    if (before !== undefined && before !== job.status && TERMINAL.includes(job.status)) {
      emitted.push({ sessionId: next.sessionId, jobId: job.id, status: job.status });
    }
    prev.set(key, job.status);
  }
  return emitted;
}
