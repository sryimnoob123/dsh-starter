import { describe, expect, it } from 'vitest';
import { classifyEvent, type MuxFrame } from './classify.js';

describe('classifyEvent（"有结果就通知"，[FR-4.1]，触发源 = 架构文档 §4.4）', () => {
  it('notifies for terminal jobs', () => {
    const frame: MuxFrame = {
      type: 'session/jobs',
      sessionId: 's1',
      jobs: [{ id: 'j1', status: 'completed' }],
    };
    expect(classifyEvent(frame)).toEqual({ type: 'result', sessionId: 's1', title: '任务完成' });
  });

  it('does not notify for still-running jobs', () => {
    const frame: MuxFrame = {
      type: 'session/jobs',
      sessionId: 's1',
      jobs: [{ id: 'j1', status: 'running' }],
    };
    expect(classifyEvent(frame)).toBeNull();
  });

  it('notifies on agent errors', () => {
    expect(
      classifyEvent({ type: 'host/agent-error', sessionId: 's2', message: 'boom' }),
    ).toEqual({ type: 'result', sessionId: 's2', title: '出错了' });
  });

  it('notifies on approval/question requests (FR-24 联动)', () => {
    expect(classifyEvent({ type: 'approval/requested', sessionId: 's3' })).toEqual({
      type: 'result',
      sessionId: 's3',
      title: '等待确认',
    });
    expect(classifyEvent({ type: 'question/requested', sessionId: 's4' })).toEqual({
      type: 'result',
      sessionId: 's4',
      title: '等待确认',
    });
  });

  it('ignores unrelated frames', () => {
    expect(classifyEvent({ type: 'session/subscribed', sessionId: 's5', lastSeq: 1 })).toBeNull();
  });
});
