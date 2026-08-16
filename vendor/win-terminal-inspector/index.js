/**
 * dsh-win-terminal-inspector — DSH host-composition plugin for Windows.
 *
 * Provides the missing win32 terminal inspection for persistent/PTY shells:
 * @deepseek-ai/dsh-subprocess-local's createProcessInspector() only supports
 * linux/darwin and throws `subprocess-local: terminal inspection is
 * unsupported on platform win32` when a terminal (persistent bash) spawns.
 *
 * Injection point (no node_modules patching):
 * LocalSubprocessRuntime.spawnTerminal reads the public `terminalInspector`
 * test hook: `this.terminalInspector ?? createProcessInspector()`. This
 * plugin wraps `spawnTerminal` on the live runtime instance so every Windows
 * terminal gets its own WindowsProcessInspector, which is then attached to
 * the spawned node-pty terminal for authentic ConPTY Ctrl-C delivery.
 *
 * Both mutations are instance-level, guarded, and fully reversible on
 * dispose, so loader hot-reloads and rollbacks leave the runtime untouched.
 */
import { WindowsProcessInspector } from "./lib/inspector.js";

export const name = "dsh-win-terminal-inspector";
export const inject = ["subprocess"];

export function apply(ctx) {
  if (process.platform !== "win32") return;
  const runtime = ctx.subprocess;
  if (runtime === undefined || typeof runtime.spawnTerminal !== "function") return;
  const original = runtime.spawnTerminal;

  // Serialize spawns: `terminalInspector` is a single instance field read by
  // spawnTerminal, so overlapping spawns must not interleave their
  // set/clear. Terminal spawns are rare; the queue adds no real latency.
  let chain = Promise.resolve();
  const wrapped = (spec) => {
    const run = chain.then(async () => {
      const inspector = new WindowsProcessInspector();
      runtime.terminalInspector = inspector;
      try {
        const handle = await original.call(runtime, spec);
        if (handle !== undefined && handle.terminal !== undefined) inspector.attach(handle.terminal);
        return handle;
      } finally {
        if (runtime.terminalInspector === inspector) runtime.terminalInspector = undefined;
      }
    });
    chain = run.then(() => {}, () => {});
    return run;
  };

  runtime.spawnTerminal = wrapped;
  return () => {
    if (runtime.spawnTerminal === wrapped) delete runtime.spawnTerminal;
  };
}

export { WindowsProcessInspector } from "./lib/inspector.js";
