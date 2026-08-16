/**
 * WindowsProcessInspector — the win32 counterpart of LinuxProcessInspector /
 * MacProcessInspector in @deepseek-ai/dsh-subprocess-local.
 *
 * Windows has neither /proc nor POSIX process groups/sessions, so the
 * implementation is built on one process-table query (Win32_Process via
 * powershell.exe CIM) and maps the POSIX concepts onto the Windows console
 * model:
 *
 * - The whole ConPTY tree rooted at the shell is one "process group" whose
 *   pgid is the shell pid. `foregroundPgid(shellPid)` therefore returns the
 *   shell pid while it is alive. Every process spawned from the shell shares
 *   the same pseudo console, so a single Ctrl-C delivered through the ConPTY
 *   input reaches the foreground job exactly like a real console keystroke.
 *
 * - POSIX process sessions do not exist; `processSession()` returns [].
 *
 * - `isStdinWaiting()` returns false (no syscall inspection on Windows).
 *   Readiness detection in dsh-terminal-bash is prompt-driven, so this
 *   matches the macOS implementation's behavior.
 *
 * - Windows has no graceful TERM for console processes: both SIGTERM and
 *   SIGKILL force-terminate via TerminateProcess / taskkill. Teardown still
 *   honors the TERM→grace→KILL ladder timing of the caller.
 *
 * Signal delivery:
 * - SIGINT/SIGBREAK: write 0x03 (ETX) into the ConPTY input of the attached
 *   terminal. ConPTY's cooked input translates it into a CTRL_C_EVENT for the
 *   console — verified empirically with Git Bash. When no terminal is
 *   attached, fall back to force-terminating the group members except the
 *   root (interrupt degraded to kill of the running command).
 * - SIGTERM/SIGKILL on a group: taskkill /PID <pgid> /T /F.
 */
import { spawnSync } from "node:child_process";

/** One Win32_Process row normalized for the inspector. */
export class WindowsProcessEntry {
  pid = 0;
  parentPid = 0;
  session = 0;
  /** UTC creation time (ISO with ms) — the `started` identity string. */
  started = "";
}

/**
 * PowerShell script returning a JSON array of Win32_Process rows.
 * CreationDate arrives either as a .NET DateTime (locale strings) or as a
 * CIM datetime string depending on the provider/version, so both shapes are
 * handled; rows without a usable creation time keep `created = null`.
 */
export const PS_TABLE_SCRIPT = String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Get-CimInstance Win32_Process | ForEach-Object {
  $created = $null
  $cd = $_.CreationDate
  if ($cd -is [datetime]) {
    $created = $cd.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  } elseif ($cd -is [string] -and $cd.Length -gt 0) {
    try { $created = ([System.Management.ManagementDateTimeConverter]::ToDateTime($cd)).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } catch { $created = $null }
  }
  [PSCustomObject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    session = [int]$_.SessionId
    created = $created
  }
} | ConvertTo-Json -Compress
`;

/** Run one process-table query with powershell.exe. */
export function defaultTableExec(powershell = "powershell.exe") {
  const result = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", PS_TABLE_SCRIPT], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`dsh-win-terminal-inspector: process-table query failed (exit ${result.status}): ${result.stderr ?? ""}`);
  }
  return result.stdout;
}

/** Parse the PowerShell JSON output into entries. */
export function parseTable(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`dsh-win-terminal-inspector: invalid process-table JSON: ${String(error)}`, { cause: error });
  }
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const entries = [];
  for (const item of list) {
    if (item === null || typeof item !== "object") continue;
    const pid = Number(item.pid);
    const parentPid = Number(item.ppid);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parentPid)) continue;
    const entry = new WindowsProcessEntry();
    entry.pid = pid;
    entry.parentPid = parentPid;
    entry.session = Number.isSafeInteger(Number(item.session)) ? Number(item.session) : 0;
    entry.started = typeof item.created === "string" ? item.created : "";
    entries.push(entry);
  }
  return entries;
}

/** Kill one Windows process tree via taskkill /T /F (idempotent). */
export function defaultTaskkill(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
}

/** Build a children-first, cycle-safe subtree list like the POSIX implementation. */
export function buildProcessTree(entries, rootPid) {
  const root = new Map(entries.map((entry) => [entry.pid, entry])).get(rootPid);
  if (root === undefined) return [];
  const byParent = new Map();
  for (const entry of entries) {
    const children = byParent.get(entry.parentPid) ?? [];
    children.push(entry);
    byParent.set(entry.parentPid, children);
  }
  const visited = new Set();
  const result = [];
  const visit = (entry) => {
    if (visited.has(entry.pid)) return;
    visited.add(entry.pid);
    for (const child of byParent.get(entry.pid) ?? []) visit(child);
    result.push({ pid: entry.pid, started: entry.started });
  };
  visit(root);
  return result;
}

/**
 * ProcessInspector implementation for Windows terminals.
 *
 * Options (all optional, for tests and tuning):
 * - exec(file, args): run one process-table query, return stdout string
 * - ttlMs: process-table cache lifetime
 * - now(): monotonic-ish clock
 * - taskkill(pid): force-terminate one process tree
 * - kill(pid, signal): single-process kill
 */
export class WindowsProcessInspector {
  exec;
  ttlMs;
  now;
  taskkill;
  killOne;
  #table;
  #tableAt = -Infinity;
  /** Optional terminal attachment used for ConPTY Ctrl-C delivery. */
  terminal;

  constructor(options = {}) {
    this.exec = options.exec ?? (() => defaultTableExec(options.powershell));
    this.ttlMs = options.ttlMs ?? 300;
    this.now = options.now ?? Date.now;
    this.taskkill = options.taskkill ?? defaultTaskkill;
    this.killOne = options.killOne ?? ((pid) => process.kill(pid, "SIGKILL"));
  }

  /**
   * Attach the terminal handle this inspector serves. Non-interface
   * extension: enables authentic Ctrl-C delivery through the ConPTY input.
   */
  attach(terminal) {
    this.terminal = terminal;
  }

  /** Cached Win32_Process table. */
  processTable() {
    const elapsed = this.now() - this.#tableAt;
    if (this.#table !== undefined && elapsed >= 0 && elapsed < this.ttlMs) return this.#table;
    this.#table = parseTable(this.exec());
    this.#tableAt = this.now();
    return this.#table;
  }

  entry(pid) {
    return this.processTable().find((entry) => entry.pid === pid);
  }

  foregroundPgid(shellPid) {
    return this.entry(shellPid) !== undefined ? shellPid : undefined;
  }

  isStdinWaiting(_pgid) {
    return false;
  }

  processTree(rootPid) {
    return buildProcessTree(this.processTable(), rootPid);
  }

  processSession(_sessionId) {
    return [];
  }

  isAlive(identity) {
    const entry = this.entry(identity.pid);
    return entry !== undefined && entry.started === identity.started;
  }

  signalGroup(pgid, signal) {
    if (!Number.isSafeInteger(pgid) || pgid <= 0) return;
    if (signal === "SIGINT" || signal === "SIGBREAK") {
      const terminal = this.terminal;
      if (terminal !== undefined) {
        try {
          terminal.write("\x03");
          return;
        } catch (_inputWriteFailed) {
          // fall through to the degraded path below
        }
      }
      // Degraded: no attached terminal — kill the group members except the root.
      for (const member of this.processTree(pgid)) {
        if (member.pid === pgid) continue;
        try {
          this.killOne(member.pid);
        } catch (_alreadyExited) {}
      }
      return;
    }
    // SIGTERM/SIGKILL: force-terminate the whole console tree.
    this.taskkill(pgid);
  }

  signalProcess(identity, signal) {
    if (!this.isAlive(identity)) return;
    try {
      this.killOne(identity.pid);
    } catch (_alreadyExited) {
      try {
        this.taskkill(identity.pid);
      } catch {}
    }
  }
}

/** Create an inspector through the same factory shape as createProcessInspector. */
export function createWindowsProcessInspector(options) {
  return new WindowsProcessInspector(options);
}
