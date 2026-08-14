import { describe, expect, it } from 'vitest';
import { diffJobs, type JobSnapshot } from './catchup.js';

const snapshot = (sessionId: string, jobs: JobSnapshot['jobs']): JobSnapshot => ({
  sessionId,
  jobs,
});

describe('diffJobs（断线补偿 catch-up，架构文档 §4.4；基线回放不通知）', () => {
  it('首次见到的终态 job（基线回放）只记录不通知', () => {
    const prev = new Map<string, 'running'>();
    const emitted = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]));
    expect(emitted).toEqual([]);
    // 但状态已记录：同一快照再来也不会补发
    expect(diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]))).toEqual([]);
  });

  it('见过运行态后转终态 → 通知一次', () => {
    const prev = new Map<string, 'running'>([['s1:j1', 'running']]);
    expect(diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]))).toEqual([
      { sessionId: 's1', jobId: 'j1', status: 'completed' },
    ]);
  });

  it('is idempotent: a repeated snapshot emits nothing', () => {
    const prev = new Map<string, 'running'>([['s1:j1', 'running']]);
    const first = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]));
    expect(first).toHaveLength(1);
    const second = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'completed' }]));
    expect(second).toEqual([]);
  });

  it('emits when a job transitions into a terminal state', () => {
    const prev = new Map<string, 'running'>([['s1:j1', 'running']]);
    const emitted = diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'failed' }]));
    expect(emitted).toEqual([{ sessionId: 's1', jobId: 'j1', status: 'failed' }]);
  });

  it('does not emit for still-running jobs', () => {
    const prev = new Map<string, 'running'>([['s1:j1', 'running']]);
    expect(diffJobs(prev, snapshot('s1', [{ id: 'j1', status: 'running' }]))).toEqual([]);
  });

  it('tracks jobs per session (same job id in two sessions are distinct)', () => {
    const prev = new Map<string, 'running'>([
      ['s1:j1', 'running'],
      ['s2:j1', 'running'],
    ]);
    const emitted = diffJobs(prev, snapshot('s2', [{ id: 'j1', status: 'completed' }]));
    expect(emitted).toEqual([{ sessionId: 's2', jobId: 'j1', status: 'completed' }]);
  });

  it('job 在两次快照间直接以终态出现（无 running 帧）→ 不通知（宁可少弹不误弹）', () => {
    const prev = new Map<string, 'running'>();
    expect(diffJobs(prev, snapshot('s1', [{ id: 'fresh', status: 'completed' }]))).toEqual([]);
  });
});
