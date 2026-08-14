import { join } from 'node:path';

/** 日志落点（[FR-3.4]）：userData/logs/ 下的壳日志与服务日志 */
export function logDir(userData: string): string {
  return join(userData, 'logs');
}

export function logFile(userData: string, name: string): string {
  return join(logDir(userData), name);
}
