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
    // 非终态 → 终态 = 真完成 → 通知；
    // 已是终态后的状态变化（如 failed→completed 归因修正）不再补发，防同一 job 双通知
    const wasTerminal = before !== undefined && TERMINAL.includes(before);
    if (before !== undefined && !wasTerminal && TERMINAL.includes(job.status)) {
      emitted.push({ sessionId: next.sessionId, jobId: job.id, status: job.status });
    }
    prev.set(key, job.status);
  }
  return emitted;
}

/**
 * 跨连接存活的 job 状态跟踪器（评审 C1 修复）：
 * jobState 曾声明在 subscribeEvents() 内——每次断线重连都 new Map()，
 * 重连后的首个快照里所有 job 都是"首次见"，终态一律静默，断线补偿（[FR-4.1]）失效。
 * 提升为模块级单例：首次连接 = 基线回放（静默），重连 = 记忆存活（补发断线期间
 * running→终态的 job）。状态量按 job 数增长，设上限防长驻膨胀（FIFO 淘汰）。
 */
const MAX_TRACKED_JOBS = 5000;

export class JobTracker {
  private readonly prev = new Map<string, JobStatus>();

  apply(next: JobSnapshot): TerminalJob[] {
    const emitted = diffJobs(this.prev, next);
    // FIFO 淘汰：超出上限删最旧（Map 迭代序 = 插入序）
    while (this.prev.size > MAX_TRACKED_JOBS) {
      const oldest = this.prev.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.prev.delete(oldest);
    }
    return emitted;
  }
}
