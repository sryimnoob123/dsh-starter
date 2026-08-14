import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { logDir, logFile } from './paths.js';

describe('logDir/logFile（日志落点 = userData/logs，架构文档 §8.3）', () => {
  it('builds the logs directory under userData', () => {
    const userData = join('C:', 'Users', 'u', 'AppData', 'Roaming', 'deepseekharness');
    expect(logDir(userData)).toBe(join(userData, 'logs'));
  });

  it('builds named log files', () => {
    const userData = join('C:', 'u');
    expect(logFile(userData, 'shell.log')).toBe(join(userData, 'logs', 'shell.log'));
    expect(logFile(userData, 'service.log')).toBe(join(userData, 'logs', 'service.log'));
  });
});
