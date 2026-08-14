import { describe, expect, it } from 'vitest';
import { redact, buildLogLine } from './redact.js';

describe('redact（日志凭据脱敏，架构文档 §8.5）', () => {
  it('redacts OpenAI-style keys', () => {
    expect(redact('api key: sk-abcdefghijklmnopqrstuvwxyz1234567890')).toBe(
      'api key: [REDACTED]',
    );
  });

  it('redacts Bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('redacts key=value secrets', () => {
    expect(redact('DEEPSEEK_API_KEY=622c65615daf4aa9bee0df0e10764507')).toBe(
      'DEEPSEEK_API_KEY=[REDACTED]',
    );
  });

  it('leaves ordinary content untouched (no false positives on short words)', () => {
    const line = 'dsh web: http://127.0.0.1:3080';
    expect(redact(line)).toBe(line);
    expect(redact('port=3080, sk (short)')).toBe('port=3080, sk (short)');
  });
});

describe('buildLogLine', () => {
  it('formats timestamp + level + message', () => {
    const line = buildLogLine('info', 'hello', new Date('2026-08-14T12:00:00.000Z'));
    expect(line).toBe('[2026-08-14T12:00:00.000Z] [info] hello');
  });
});
