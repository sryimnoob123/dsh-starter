import { existsSync, renameSync, rmSync, statSync } from 'node:fs';

/**
 * 日志轮转（壳长驻托盘，日志会无限增长）：超过上限就把当前文件改名为 .old
 * （覆盖旧 .old），下一次 append 重建新文件。简单、无第三方依赖。
 */

export const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;

export function maybeRotateLog(file: string, maxBytes: number = DEFAULT_MAX_LOG_BYTES): void {
  try {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size < maxBytes) return;
    const old = `${file}.old`;
    if (existsSync(old)) rmSync(old, { force: true });
    renameSync(file, old);
  } catch {
    // 轮转失败不影响日志写入
  }
}
