import { describe, expect, it } from 'vitest';
import { diffJobs, type JobSnapshot } from './catchup.js';

const snapshot = (sessionId: string, jobs: JobSnapshot['jobs']): JobSnapshot => ({
  sessionId,
  jobs,
});

describe('diffJobs（断线补偿 catch-up，架构文档 §4.4）', () => {
  it('emits newly-terminal jobs exactly once', () => {
    const prev = new Map<string, 'running'>();
    const emitted = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]));
    expect(emitted).toEqual([{ sessionId: 's1', jobId: 'j1', status: 'completed' }]);
  });

  it('is idempotent: a repeated snapshot emits nothing', () => {
    const prev = new Map<string, 'completed'>();
    const first = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]));
    expect(first).toHaveLength(1);
    // 同一快照再来一次：状态未变化 → 不再补发
    const second = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]));
    expect(second).toEqual([]);
  });

  it('emits when a job transitions into a terminal state', () => {
    const prev = new Map<string, 'running'>([['s1:j1', 'running']]);
    const emitted = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'failed' }]));
    expect(emitted).toEqual([{ sessionId: 's1', jobId: 'j1', status: 'failed' }]);
  });

  it('does not emit for still-running jobs', () => {
    const prev = new Map<string, 'running'>();
    expect(diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'running' }]))).toEqual([]);
  });

  it('tracks jobs per session (same job id in two sessions are distinct)', () => {
    const prev = new Map<string, 'running'>([['s1:j1', 'running']]);
    const emitted = diffJobs(prev, snapshot('s2', [{ id: 'j1', status: 'completed' }]));
    expect(emitted).toEqual([{ sessionId: 's2', jobId: 'j1', status: 'completed' }]);
  });
});
