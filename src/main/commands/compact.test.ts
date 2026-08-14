import { describe, expect, it } from 'vitest';
import {
  buildCompactPayload,
  buildCompactPromptContent,
  describeCompactFeedback,
  parseCurrentSessionId,
} from './compact.js';

describe('parseCurrentSessionId（dsh.sessions.current 解析）', () => {
  it('解析合法 JSON', () => {
    expect(parseCurrentSessionId('{"sessionId":"s1"}')).toBe('s1');
    expect(parseCurrentSessionId(' { "sessionId": "session-ee30816e" } ')).toBe('session-ee30816e');
  });

  it.each([null, '', '   ', 'not-json', '{"sessionId":123}', '{"other":1}', '"s1"', '[]', 'null', '{}'])(
    '无当前会话 → null（%s）',
    (v) => {
      expect(parseCurrentSessionId(v)).toBeNull();
    },
  );
});

describe('buildCompactPromptContent / buildCompactPayload（session.prompt 斜杠命令）', () => {
  it('内容 = 单个以 / 开头的文本块（DSH 判定为斜杠命令）', () => {
    expect(buildCompactPromptContent()).toEqual([{ type: 'text', text: '/compact' }]);
  });

  it('载荷形状 = session.prompt 官方契约（queue 模式）', () => {
    expect(buildCompactPayload('s1')).toEqual({
      sessionId: 's1',
      mode: 'queue',
      content: [{ type: 'text', text: '/compact' }],
    });
  });
});

describe('describeCompactFeedback（响应 command.text 提取）', () => {
  it('成功命令带文本时返回文本', () => {
    expect(describeCompactFeedback({ accepted: true, command: { kind: 'success', text: 'Done.' } })).toBe('Done.');
  });

  it.each([null, undefined, {}, { accepted: true }, { command: { kind: 'success' } }, { command: { kind: 'other', text: 'x' } }])(
    '无文本 → null（%s）',
    (v) => {
      expect(describeCompactFeedback(v)).toBeNull();
    },
  );
});
