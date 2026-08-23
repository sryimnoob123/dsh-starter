/**
 * In-memory event log for issue reports: what the market did and how it
 * failed, exportable as plain text from `/dsh-market/logs`.
 *
 * Privacy: entries are sanitized on write — the home directory collapses to
 * `~`, and common credential shapes (API keys, GitHub/npm tokens, bearer
 * headers) are masked. Nothing is persisted to disk; the buffer dies with the
 * process and holds at most {@link MAX_ENTRIES} entries.
 */
export type LogLevel = 'info' | 'warn' | 'error';
/**
 * Append one event, sanitized and truncated.
 * @param level - severity for the export listing.
 * @param event - short machine-ish event name (e.g. `install`, `hot-mount`).
 * @param detail - free-form context; credentials and home paths are masked.
 */
export declare function logEvent(level: LogLevel, event: string, detail: string): void;
/**
 * The export document for bug reports.
 * @param header - environment lines to prepend (version, platform — no paths).
 * @returns plain text, newest entry last.
 */
export declare function exportLogs(header: Record<string, string>): string;
