/**
 * 日志落盘与凭据脱敏（架构文档 §8.3/§8.5）：
 * - 壳日志 + 服务 stdout/stderr 落盘 userData/logs（[FR-3.4] 托盘"查看日志"入口）
 * - 疑似凭据模式（sk-… / Bearer … / KEY=…）脱敏后再落盘，防 debug 日志泄 key
 */

const SK_KEY = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g;
// 收窄为常见凭据词（KEY/TOKEN/SECRET/PASSWORD/PASSWD/CREDENTIAL，可带前缀后缀），
// 不再匹配 MONKEY= / KEYWORD= 这类含 KEY 子串的非凭据（误伤）
const KEY_VALUE = /\b((?:[A-Z0-9_]+_)?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)(?:_[A-Z0-9_]+)?)=[A-Za-z0-9._~+/=-]{16,}\b/g;

export function redact(line: string): string {
  return line.replace(SK_KEY, '[REDACTED]').replace(BEARER, 'Bearer [REDACTED]').replace(KEY_VALUE, '$1=[REDACTED]');
}

export function buildLogLine(level: string, message: string, now: Date = new Date()): string {
  return `[${now.toISOString()}] [${level}] ${message}`;
}
